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
    exports, Request, Response, URL, Error, Buffer, AbortSignal, TextDecoder, Uint8Array,
    console: { warn() {} }, process: { env: {} },
    require: name => overrides[name] ?? (name === "node:crypto" || name === "next/server" ? require(name) : {}),
    ...globals,
  });
  return exports;
}
const env = { RESEND_API_KEY: "test-email-key", EMAIL_FROM: "alerts@example.com", NEXT_PUBLIC_ONESIGNAL_APP_ID: "test-app", ONESIGNAL_REST_API_KEY: "test-push-key" };
const capability = compile("src/lib/dancr/customer-notification-delivery.ts", {"./web-push-config":{webPushConfig:()=>({publicKey:"synthetic-public-key"})}}, { process: { env } });

test("customer email defaults off while in-app and push choices and saved opt-outs are preserved", () => {
  for (const stored of [null, {}, { followedDancersOnly: true, anyDancerInCity: false }]) {
    assert.equal(preferences.customerNotificationSettings(stored).emailEnabled, false);
    assert.ok(Object.entries(preferences.customerNotificationSettings(stored)).filter(([key]) => !["emailEnabled", "followEmailEnabled"].includes(key)).every(([,value]) => value === true));
  }
  for (const key of Object.keys(preferences.DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS)) {
    assert.equal(preferences.customerNotificationSettings({ [key]: false })[key], false);
  }
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

test("capabilities use server configuration and expose only the public Web Push key", () => {
  const available = capability.customerNotificationDelivery("customer-one", "customer@example.com");
  assert.equal(available.emailAvailable, true);
  assert.equal(available.pushAvailable, true);
  assert.equal(available.pushPublicKey, "synthetic-public-key");
  assert.ok(!JSON.stringify(available).includes(env.ONESIGNAL_REST_API_KEY));
  assert.equal(available.pushExternalId, undefined);
  assert.equal(capability.customerNotificationDelivery("customer-one").emailAvailable, false);
  const unavailable = compile("src/lib/dancr/customer-notification-delivery.ts", {"./web-push-config":{webPushConfig:()=>null}});
  assert.deepEqual(plain(unavailable.customerNotificationDelivery("one", "a@example.com")), { emailAvailable: false, pushAvailable: false });
});

function profileFixture(available = true) {
  const writes = [];
  const route = compile("app/api/customer/profile/route.ts", {
    "@/src/lib/dancr/customer-notification-preferences": preferences,
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/customer-email-consent": { setCustomerEmailPreference: async (_client, userId, enabled, _source, _version, key) => {
      writes.push({ userId, notificationSettings: { [key]: enabled } });
      return { userId, notificationSettings: { [key]: enabled } };
    } },
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
  const verifiedLookups = [];
  const recipients = [{ id: "customer-one", email: "customer@example.com", role: "customer" }, { id: "dancer-one", email: "dancer@example.com", role: "dancer" }];
  const client = { auth: { admin: { getUserById: async id => {
    verifiedLookups.push(id);
    return { data: { user: options.missingUser ? null : { email: "verified@example.com", email_confirmed_at: options.unverified ? null : "2026-10-30T00:00:00Z" } }, error: options.authError };
  } } }, rpc: async (name, args) => {
    assert.equal(name, "customer_email_channel_delivery_target"); assert.ok(["follow", "marketing"].includes(args.p_channel)); assert.equal(args.p_user_id, "customer-one");
    return { data: options.noConsent ? null : { email: "customer@example.com", token: "a".repeat(64) }, error: options.consentError };
  }, from(table) {
    const result = table === "app_users" ? { data: recipients } : { data: options.missing ? [] : [{ user_id: "customer-one", notification_settings: settings }], error: options.error };
    const query = { select() { return query; }, in() { return query; }, eq(column, value) { assert.equal(column, "account_state"); assert.equal(value, "active"); return query; }, then(resolve) { return Promise.resolve(result).then(resolve); } };
    return query;
  } };
  const delivery = compile("src/lib/dancr/notification-delivery.ts", {
    "./customer-notification-preferences": preferences,
    "./web-push-delivery": {deliverWebPush:async (_client,recipient_id,message)=>{requests.push({body:{recipient_id,...message}});return true}},
    "./public-app-url": { publicAppUrl: () => "https://mydancr.com" },
  }, { process: { env }, fetch: async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return Response.json({ id: "aabbccdd-1111-4111-8111-aabbccddeeff" });
  } });
  return { requests, verifiedLookups, client, ...delivery };
}
const row = (kind, recipient_id = "customer-one") => ({ recipient_id, notification_type: "engagement", title: "Test alert", body: "Test body", payload: { kind } });

test("VIP receipts and decisions email the verified guest without marketing consent; push stays optional", async () => {
  for (const status of ["pending", "confirmed", "declined", "cancelled"]) {
    const f = deliveryFixture({ emailEnabled: false, followEmailEnabled: false, pushEnabled: false }, { noConsent: true });
    const notice = { ...row("vip_request_status"), id: `notice-${status}`, payload: { kind: "vip_request_status", status } };
    assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [notice])), { email: 1, push: 0 });
    assert.deepEqual(f.verifiedLookups, ["customer-one"]);
    assert.equal(f.requests[0].body.to, "verified@example.com");
    assert.match(f.requests[0].body.text, /https:\/\/mydancr.com\/vip/);
    assert.equal(f.requests[0].headers["Idempotency-Key"], `notification/notice-${status}`);
    assert.equal(f.requests[0].body.headers, undefined);
  }
});

test("VIP request emails fail closed for unverified, missing or unreadable auth accounts", async () => {
  for (const options of [{ unverified: true }, { missingUser: true }, { authError: { message: "unavailable" } }]) {
    const f = deliveryFixture({ pushEnabled: false }, options);
    assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row("vip_request_status")])), { email: 0, push: 0 });
    assert.equal(f.requests.length, 0);
  }
});

test("club offers cannot bypass the daily digest and dedicated push worker", async () => {
  const f = deliveryFixture({ followEmailEnabled: true, emailEnabled: true, pushEnabled: true });
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row("club_offer")])), { email: 0, push: 0 });
  assert.equal(f.requests.length, 0);
});

test("follow emails and marketing subscriptions deliver independently", async () => {
  for (const [settings,subject] of [[{followEmailEnabled:true,emailEnabled:false},"Followed"],[{followEmailEnabled:false,emailEnabled:true},"Offers"]]) {
    const f=deliveryFixture({...settings,pushEnabled:false});
    const rows=[{...row(kinds.workingNow),title:"Followed"},{...row("newsletter"),title:"Offers"}];
    assert.deepEqual(plain(await f.deliverNotificationRows(f.client,rows)),{email:1,push:0});
    assert.deepEqual(f.requests.map(r=>r.body.subject),[subject]);
  }
});

test("the profile API handles follow email consent separately and rejects mixed consent writes",async()=>{
  const f=profileFixture();
  assert.equal((await f.PATCH(patch({notificationSettings:{followEmailEnabled:true},emailConsentSource:"account_preferences",emailConsentVersion:preferences.CUSTOMER_EMAIL_CONSENT_VERSION}))).status,200);
  assert.deepEqual(f.writes,[{userId:"signed-in-customer",notificationSettings:{followEmailEnabled:true}}]);
  for(const notificationSettings of [{followEmailEnabled:true,emailEnabled:true},{followEmailEnabled:false,pushEnabled:false}])
    assert.equal((await f.PATCH(patch({notificationSettings}))).status,400);
  assert.equal((await profileFixture(false).PATCH(patch({notificationSettings:{followEmailEnabled:true}}))).status,503);
});

for (const [key, kind] of Object.entries(kinds)) test(key + " opt-out prevents that event reaching email or push", async () => {
  const f = deliveryFixture({ emailEnabled: true, followEmailEnabled: true, pushEnabled: true, [key]: false });
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row(kind)])), { email: 0, push: 0 });
  assert.equal(f.requests.length, 0);
  const otherKind = Object.values(kinds).find(value => value !== kind);
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row(otherKind)])), { email: 1, push: 1 });
  assert.equal(f.requests[0].body.recipient_id, "customer-one");
  assert.equal(f.requests[0].body.url, "https://mydancr.com/dashboard/customer#customer-alerts");
});

test("delivery respects independent channels, master pause, defaults and unavailable preferences", async () => {
  for (const [settings, expected] of [
    [{}, { email: 0, push: 1 }],
    [{ pushEnabled: false }, { email: 0, push: 0 }],
    [{ emailEnabled: false }, { email: 0, push: 1 }],
    [{ emailEnabled: false, pushEnabled: false }, { email: 0, push: 0 }],
    [{ emailEnabled: true, followEmailEnabled: true, pushEnabled: true, followAlertsEnabled: false }, { email: 0, push: 0 }],
  ]) {
    const f = deliveryFixture(settings);
    assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row(kinds.workingNow)])), expected);
  }
  const failed = deliveryFixture({ emailEnabled: true, followEmailEnabled: true, pushEnabled: true }, { error: new Error("unavailable") });
  assert.deepEqual(plain(await failed.deliverNotificationRows(failed.client, [row(kinds.workingNow), row(kinds.workingNow, "inactive-account")])), { email: 0, push: 0 });
  assert.equal(failed.requests.length, 0);
  const missing = deliveryFixture({}, { missing: true });
  assert.deepEqual(plain(await missing.deliverNotificationRows(missing.client, [row(kinds.workingNow)])), { email: 0, push: 0 });
  assert.equal(missing.requests.length, 0);
});

test("customer choices do not suppress transactional email or other account roles", async () => {
  const f = deliveryFixture({ followAlertsEnabled: false }, { error: new Error("unavailable") });
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row("support_reply", "dancer-one")])), { email: 1, push: 1 });
  assert.equal(f.requests[0].body.recipient_id, "dancer-one");
  assert.equal((await f.sendTransactionalEmail({ to: "customer@example.com", subject: "Password changed", text: "Test" })).delivered, true);
});

test("email fails closed without a fresh consent receipt and includes anonymous unsubscribe controls", async () => {
  for (const options of [{ noConsent: true }, { consentError: new Error("unavailable") }]) {
    const f = deliveryFixture({ emailEnabled: true, followEmailEnabled: true, pushEnabled: false }, options);
    assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [row("newsletter")])), { email: 0, push: 0 });
    assert.equal(f.requests.length, 0);
  }
  const f = deliveryFixture({ emailEnabled: true, followEmailEnabled: true, pushEnabled: false });
  await f.deliverNotificationRows(f.client, [row("newsletter")]);
  const email = f.requests[0].body;
  assert.ok(email.text.includes("/email-preferences/" + "a".repeat(64)));
  assert.ok(email.html.includes("/email-preferences/" + "a".repeat(64)));
  assert.equal(email.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(email.headers["List-Unsubscribe"], "<https://mydancr.com/api/public/customer-email?token=" + "a".repeat(64) + ">");
});

test("email unsubscribe suppresses all optional kinds while preserving push, and subscribe restores delivery", async () => {
  const settings = { emailEnabled: false, pushEnabled: true };
  const f = deliveryFixture(settings);
  const rows = [...Object.values(kinds), "newsletter", "club_promotion", "advertisement", "support_reply"].map(kind => row(kind));
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, rows)), { email: 0, push: rows.length });
  assert.equal(f.requests.filter(request => request.url).length, 0);
  settings.emailEnabled = true; settings.followEmailEnabled = true;
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, rows)), { email: rows.length, push: rows.length });
});

test("VIP working alerts default on and honor channel and master/category mutes, with club-specific links", async () => {
  const vipRow = { ...row("vip_dancer_working_now"), payload: { kind: "vip_dancer_working_now", venueId: "club-one" } };
  for (const settings of [{ emailEnabled: false, pushEnabled: false }, { workingNow: false }, { followAlertsEnabled: false }]) {
    const f = deliveryFixture(settings);
    assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [vipRow])), { email: 0, push: 0 });
  }
  const f = deliveryFixture({ followEmailEnabled: true });
  assert.deepEqual(plain(await f.deliverNotificationRows(f.client, [vipRow])), { email: 1, push: 1 });
  assert.equal(f.requests[0].body.url, "https://mydancr.com/vip?venueId=club-one#vip-plan");
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
    if (table === "venues" || table === "dancer_profiles") {
      const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => ({ data: { id: table === "venues" ? "club" : "dancer" }, error: null }) };
      return query;
    }
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
