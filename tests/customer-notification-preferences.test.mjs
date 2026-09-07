import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as preferences from "../src/lib/dancr/customer-notification-preferences.ts";

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function compile(path, overrides = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, Request, Response, URL, Error, Buffer, AbortSignal,
    console: { warn() {} }, process: { env: {} },
    require: name => overrides[name] ?? (name === "node:crypto" || name === "next/server" ? require(name) : {}),
    ...globals,
  });
  return exports;
}
const env = { RESEND_API_KEY: "test-email-key", EMAIL_FROM: "alerts@example.com", NEXT_PUBLIC_ONESIGNAL_APP_ID: "test-app", ONESIGNAL_REST_API_KEY: "test-push-key" };
const capability = compile("src/lib/dancr/customer-notification-delivery.ts", {}, { process: { env } });

test("legacy settings retain four in-app alerts while email and push require opt-in", () => {
  assert.equal(preferences.customerNotificationSettings(null).emailEnabled, false);
  assert.equal(preferences.customerNotificationSettings({}).pushEnabled, false);
  for (const { key } of preferences.CUSTOMER_FOLLOW_ALERTS) {
    assert.equal(preferences.customerFollowAlertEnabled({}, key), true);
    assert.equal(preferences.customerFollowAlertEnabled({ followAlertsEnabled: false }, key), false);
    assert.equal(preferences.customerFollowAlertEnabled({ [key]: false }, key), false);
    for (const other of preferences.CUSTOMER_FOLLOW_ALERTS.filter(x => x.key !== key)) {
      assert.equal(preferences.customerFollowAlertEnabled({ [key]: false }, other.key), true);
    }
  }
});

test("preference patches reject unknown, empty and non-boolean values", () => {
  for (const invalid of [null, [], {}, true, { workingNow: "off" }, { arbitrary: true }, { emailEnabled: 1 }]) {
    assert.throws(() => preferences.parseCustomerNotificationPatch(invalid));
  }
  assert.deepEqual(preferences.parseCustomerNotificationPatch({ clubDeals: false }), { clubDeals: false });
  assert.equal(preferences.customerNotificationSettings({ emailEnabled: "true" }).emailEnabled, false);
});

test("capabilities use server configuration and expose only the customer's opaque push alias", () => {
  const available = capability.customerNotificationDelivery("customer-one", "customer@example.com");
  assert.equal(available.emailAvailable, true);
  assert.equal(available.pushAvailable, true);
  assert.equal(available.pushExternalId, capability.customerPushExternalId("customer-one"));
  assert.notEqual(available.pushExternalId, capability.customerPushExternalId("customer-two"));
  assert.ok(!JSON.stringify(available).includes(env.ONESIGNAL_REST_API_KEY));
  assert.ok(!available.pushExternalId.includes("customer-one"));
  assert.equal(capability.customerNotificationDelivery("customer-one").emailAvailable, false);
  const unavailable = compile("src/lib/dancr/customer-notification-delivery.ts");
  assert.deepEqual(plain(unavailable.customerNotificationDelivery("one", "a@example.com")), { emailAvailable: false, pushAvailable: false });
});

function profileFixture(available = true) {
  const writes = [];
  const route = compile("app/api/customer/profile/route.ts", {
    "@/src/lib/dancr/customer-notification-preferences": preferences,
    "@/src/lib/dancr/customer-notification-delivery": { customerNotificationDelivery: () => ({ emailAvailable: available, pushAvailable: available }) },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: request => request.json() },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ client: {}, user: { id: "signed-in-customer", email: "customer@example.com" }, session: { accessToken: "rotated" } }) },
    "@/src/lib/dancr/auth": {
      getCustomerProfile: async () => ({ userId: "signed-in-customer", notificationSettings: { clubDeals: false } }),
      updateCustomerProfile: async (_client, userId, update) => {
        writes.push({ userId, ...plain(update) });
        return { userId, notificationSettings: update.notificationSettings };
      },
    },
    "@/src/lib/api": { apiError: error => Response.json({ error: error.message }, { status: 500 }) },
  });
  return { writes, ...route };
}
const patch = body => new Request("https://mydancr.com/api/customer/profile", { method: "PATCH", body: JSON.stringify(body) });

test("profile saves only the authenticated user's requested keys and returns confirmed settings", async () => {
  const f = profileFixture();
  const response = await f.PATCH(patch({ userId: "someone-else", notificationSettings: { workingNow: false } }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.writes, [{ userId: "signed-in-customer", notificationSettings: { workingNow: false } }]);
  const result = await response.json();
  assert.equal(result.profile.notificationSettings.workingNow, false);
  assert.equal(result.session.accessToken, "rotated");
  assert.equal((await (await f.GET(new Request("https://mydancr.com"))).json()).profile.notificationSettings.clubDeals, false);
});

test("unconfigured channels cannot be enabled but customers can always turn them off", async () => {
  const f = profileFixture(false);
  for (const key of ["emailEnabled", "pushEnabled"]) {
    assert.equal((await f.PATCH(patch({ notificationSettings: { [key]: true } }))).status, 503);
    assert.equal(f.writes.length, key === "emailEnabled" ? 0 : 1);
    assert.equal((await f.PATCH(patch({ notificationSettings: { [key]: false } }))).status, 200);
  }
  assert.equal((await f.PATCH(patch({ notificationSettings: { unknown: true } }))).status, 400);
  assert.equal(f.writes.length, 2);
});

test("partial database saves preserve other choices and retry a concurrent device edit", async () => {
  const auth = compile("src/lib/dancr/auth.ts");
  let settings = { workingNow: false, emailEnabled: true, legacyKey: "keep" };
  let attempts = 0;
  const client = { from(table) {
    assert.equal(table, "customer_profiles");
    let update;
    let expected;
    const query = {
      select() { return query; },
      eq(column, value) { if (column === "user_id") assert.equal(value, "customer-one"); else expected = value; return query; },
      single: async () => ({ data: { notification_settings: { ...settings } }, error: null }),
      update(value) { update = value; return query; },
      maybeSingle: async () => {
        attempts++;
        if (attempts === 1) settings = { ...settings, newDancers: false };
        if (expected !== JSON.stringify(settings)) return { data: null, error: null };
        settings = plain(update.notification_settings);
        return { data: { user_id: "customer-one", city: "Las Vegas", notification_settings: settings }, error: null };
      },
    };
    return query;
  } };
  const result = await auth.updateCustomerProfile(client, "customer-one", { notificationSettings: { followAlertsEnabled: false } });
  assert.equal(attempts, 2);
  assert.deepEqual(plain(result.notificationSettings), { workingNow: false, emailEnabled: true, legacyKey: "keep", newDancers: false, followAlertsEnabled: false });
});

const kinds = {
  workingNow: "followed_dancer_working_now",
  upcomingShifts: "followed_dancer_upcoming_shift",
  clubDeals: "followed_club_deal_published",
  newDancers: "followed_club_roster_addition",
};
function deliveryFixture(settings, options = {}) {
  const requests = [];
  const recipients = [{ id: "customer-one", email: "customer@example.com", role: "customer" }, { id: "dancer-one", email: "dancer@example.com", role: "dancer" }];
  const client = { from(table) {
    const result = table === "app_users" ? { data: recipients } : { data: [{ user_id: "customer-one", notification_settings: settings }], error: options.error };
    const query = { select() { return query; }, in() { return query; }, eq(column, value) { assert.equal(column, "account_state"); assert.equal(value, "active"); return query; }, then(resolve) { return Promise.resolve(result).then(resolve); } };
    return query;
  } };
  const delivery = compile("src/lib/dancr/notification-delivery.ts", {
    "./customer-notification-preferences": preferences,
    "./customer-notification-delivery": capability,
    "./public-app-url": { publicAppUrl: () => "https://mydancr.com" },
  }, { process: { env }, fetch: async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return Response.json({ id: "test-notification" });
  } });
  return { requests, client, ...delivery };
}
const row = (kind, recipient_id = "customer-one") => ({ recipient_id, notification_type: "engagement", title: "Test alert", body: "Test body", payload: { kind } });

for (const [key, kind] of Object.entries(kinds)) test(key + " opt-out prevents that event reaching email or push", async () => {
  const f = deliveryFixture({ emailEnabled: true, pushEnabled: true, [key]: false });
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row(kind)])), { email: 0, push: 0 });
  assert.equal(f.requests.length, 0);
  const otherKind = Object.values(kinds).find(value => value !== kind);
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row(otherKind)])), { email: 1, push: 1 });
  assert.equal(f.requests[0].body.include_external_user_ids[0], capability.customerPushExternalId("customer-one"));
  assert.equal(f.requests[0].body.url, "https://mydancr.com/dashboard/customer#customer-alerts");
});

test("delivery respects independent channels, master pause, defaults and unavailable preferences", async () => {
  for (const [settings, expected] of [
    [{}, { email: 0, push: 0 }],
    [{ emailEnabled: true }, { email: 1, push: 0 }],
    [{ pushEnabled: true }, { email: 0, push: 1 }],
    [{ emailEnabled: true, pushEnabled: true, followAlertsEnabled: false }, { email: 0, push: 0 }],
  ]) {
    const f = deliveryFixture(settings);
    assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row(kinds.workingNow)])), expected);
  }
  const failed = deliveryFixture({ emailEnabled: true, pushEnabled: true }, { error: new Error("unavailable") });
  assert.deepEqual(plain(await failed.deliverNotificationRows(failed.client, [row(kinds.workingNow), row(kinds.workingNow, "inactive-account")])), { email: 0, push: 0 });
  assert.equal(failed.requests.length, 0);
});

test("customer choices do not suppress transactional email or other account roles", async () => {
  const f = deliveryFixture({ followAlertsEnabled: false }, { error: new Error("unavailable") });
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row("support_reply", "dancer-one")])), { email: 1, push: 1 });
  assert.equal(f.requests[0].body.include_external_user_ids[0], "dancer-one");
  assert.equal((await f.sendTransactionalEmail({ to: "customer@example.com", subject: "Password changed", text: "Test" })).delivered, true);
});

for (const [key, method] of [
  ["workingNow", "broadcastFollowedDancerWorkingNow"],
  ["upcomingShifts", "broadcastFollowedDancerUpcomingShift"],
  ["clubDeals", "broadcastFollowedClubDealPublished"],
  ["newDancers", "broadcastFollowedClubRosterAddition"],
]) test(key + " also excludes opted-out followers from the in-app inbox", async () => {
  const delivered = [];
  const broadcasts = compile("src/lib/dancr/customer-follow-notifications.ts", {
    "./customer-notification-preferences": preferences,
    "./notification-delivery": { deliverNotificationRows: async (_client, rows) => delivered.push(...rows) },
  });
  let inserted = [];
  const client = { from(table) {
    const records = {
      follows: ["yes", "no", "paused", "inactive"].map(customer_id => ({ customer_id })),
      venue_follows: ["yes", "no", "paused", "inactive"].map(customer_id => ({ customer_id })),
      app_users: ["yes", "no", "paused"].map(id => ({ id })),
      customer_profiles: [
        { user_id: "yes", notification_settings: {} },
        { user_id: "no", notification_settings: { [key]: false } },
        { user_id: "paused", notification_settings: { followAlertsEnabled: false } },
      ],
    };
    const query = { select() { return query; }, eq() { return query; }, in() { return query; },
      upsert(rows) { inserted = rows; return query; },
      then(resolve) { return Promise.resolve({ data: table === "notifications" ? inserted.map(({ id }) => ({ id })) : records[table] }).then(resolve); },
    };
    return query;
  } };
  assert.equal(await broadcasts[method](client, { dancerId: "dancer", venueId: "club", venueName: "Club", stageName: "Dancer", shiftDate: "2026-09-08", dealTitle: "Deal", eventId: "event" }), 1);
  assert.deepEqual(delivered.map(item => item.recipient_id), ["yes"]);
});
