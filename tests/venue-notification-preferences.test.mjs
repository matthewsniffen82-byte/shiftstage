import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as preferences from "../src/lib/dancr/venue-notification-preferences.ts";
import * as customerPreferences from "../src/lib/dancr/customer-notification-preferences.ts";
import * as notificationIcons from "../src/lib/dancr/notification-icon.ts";

const require = createRequire(import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const env = { RESEND_API_KEY: "synthetic-email", EMAIL_FROM: "test@example.invalid", NEXT_PUBLIC_ONESIGNAL_APP_ID: "synthetic-app", ONESIGNAL_REST_API_KEY: "synthetic-push" };
function compile(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Request, Response, URL, URLSearchParams, AbortSignal, TextDecoder, Uint8Array, process: { env }, console: { warn() {} },
    require: name => dependencies[name] ?? (name === "node:crypto" ? require(name) : {}), ...globals });
  return exports;
}
const capability = compile("src/lib/dancr/customer-notification-delivery.ts");
const examples = {
  dancerActivity: { notification_type: "shift_updated" },
  rosterChanges: { notification_type: "venue_affiliation_status" },
  clubDeals: { notification_type: "support_message", payload: { kind: "club_deal_request_updated" } },
  pickupRequests: { notification_type: "support_message", payload: { kind: "club_shuttle_request" } },
  teamAccess: { notification_type: "approval_status", payload: { kind: "venue_team_member_joined" } },
  pageAndMedia: { notification_type: "venue_publication_status" },
  supportReplies: { notification_type: "support_message", payload: { threadId: "thread" } },
  performance: { notification_type: "weekly_summary" },
};
const patchMetadata = preferences.venueNotificationMetadataPatch;

test("venue categories are independent, master pause preserves choices, and external delivery requires opt-in", () => {
  const all = Object.fromEntries(Object.keys(examples).map(key => [key, true]));
  for (const [key, row] of Object.entries(examples)) {
    const enabled = patchMetadata(all);
    assert.equal(preferences.venueNotificationCategory(row), key);
    assert.equal(preferences.venueNotificationEnabled(enabled, row), true);
    assert.equal(preferences.venueNotificationEnabled(enabled, row, "emailEnabled"), false);
    assert.equal(preferences.venueNotificationEnabled(patchMetadata({ ...all, emailEnabled: true }), row, "emailEnabled"), true);
    assert.equal(preferences.venueNotificationEnabled(patchMetadata({ ...all, alertsEnabled: false }), row), false);
    const muted = patchMetadata({ ...all, [key]: false });
    assert.equal(preferences.venueNotificationEnabled(muted, row), false);
    for (const [other, otherRow] of Object.entries(examples)) if (other !== key) assert.equal(preferences.venueNotificationEnabled(muted, otherRow), true);
  }
  assert.equal(preferences.venueNotificationSettings(null).dancerActivity, false);
  assert.equal(preferences.venueNotificationSettings(null).performance, false);
});

test("security and legal notices remain on even with every optional setting paused", () => {
  const muted = patchMetadata(Object.fromEntries(Object.keys(preferences.DEFAULT_VENUE_NOTIFICATION_SETTINGS).map(key => [key, false])));
  for (const row of [{ notification_type: "dmca_status" }, { notification_type: "approval_status", payload: { kind: "password_changed" } }]) {
    for (const channel of [undefined, "emailEnabled", "pushEnabled"]) assert.equal(preferences.venueNotificationEnabled(muted, row, channel), true);
  }
});

test("malformed and unknown settings cannot write account metadata", () => {
  for (const value of [null, [], {}, "off", { role: "admin" }, { security: false }, { emailEnabled: "true" }, { alertsEnabled: 1 }]) assert.throws(() => patchMetadata(value));
  assert.equal(preferences.venueNotificationSettings({ mydancr_venue_notify_emailEnabled: "true" }).emailEnabled, false);
});

function routeFixture({ denied = false, fail = false, available = true } = {}) {
  let metadata = { display_name: "Keep name", ...patchMetadata({ rosterChanges: false }) };
  const writes = [];
  const route = compile("app/api/venue/notification-settings/route.ts", {
    "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
    "@/src/lib/dancr/venue-notification-preferences": preferences,
    "@/src/lib/dancr/customer-notification-delivery": { customerNotificationDelivery: () => ({ emailAvailable: available, pushAvailable: available }) },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: async (request, options) => { assert.equal(options.maxBytes, 2048); return request.json(); } },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async (_request, access) => {
      assert.equal(access.role, "venue");
      if (denied) throw Object.assign(new Error("Venue access required."), { status: 403 });
      return { user: { id: "verified-venue-user", user_metadata: metadata }, session: { accessToken: "rotated" } };
    } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ auth: { admin: { updateUserById: async (id, update) => {
      writes.push({ id, ...plain(update) });
      if (fail) return { data: { user: null }, error: new Error("Unavailable") };
      metadata = { ...metadata, ...update.user_metadata };
      return { data: { user: { user_metadata: metadata } }, error: null };
    } } } }) },
    "@/src/lib/api": { apiError: error => Response.json({ ok: false }, { status: error.status || 500 }) },
  });
  return { ...route, writes, metadata: () => metadata };
}
const request = settings => new Request("https://example.invalid/api/venue/notification-settings", { method: "PATCH", body: JSON.stringify({ userId: "another-user", settings }) });
test("preferences save only for the verified team member, preserve other metadata and survive reload", async () => {
  const f = routeFixture();
  const response = await f.PATCH(request({ pickupRequests: false }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.writes, [{ id: "verified-venue-user", user_metadata: { mydancr_venue_notify_pickupRequests: false } }]);
  assert.equal(f.metadata().display_name, "Keep name");
  const saved = await response.json();
  assert.equal(saved.settings.rosterChanges, false);
  assert.equal(saved.settings.pickupRequests, false);
  const loaded = await f.GET(new Request("https://example.invalid"));
  assert.match(loaded.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual((await loaded.json()).settings, saved.settings);
});
test("denied, failed and unavailable-channel writes never report success", async () => {
  const denied = routeFixture({ denied: true });
  assert.equal((await denied.PATCH(request({ pickupRequests: false }))).status, 403);
  assert.equal(denied.writes.length, 0);
  const invalid = routeFixture();
  assert.equal((await invalid.PATCH(request({ arbitrary: true }))).status, 400);
  assert.equal(invalid.writes.length, 0);
  assert.equal((await routeFixture({ fail: true }).PATCH(request({ rosterChanges: true }))).status, 500);
  const unavailable = routeFixture({ available: false });
  for (const key of ["emailEnabled", "pushEnabled"]) {
    assert.equal((await unavailable.PATCH(request({ [key]: true }))).status, 503);
    assert.equal((await unavailable.PATCH(request({ [key]: false }))).status, 200);
  }
  assert.equal(unavailable.writes.length, 2);
});

test("delivery respects per-recipient category and channel preferences and fails closed on lookup errors", async () => {
  const calls = [];
  let metadata = patchMetadata({ emailEnabled: true, pushEnabled: true });
  let lookupError = false;
  const client = { auth: { admin: { getUserById: async id => {
    assert.equal(id, "venue-user");
    return lookupError ? { data: {}, error: new Error("Unavailable") } : { data: { user: { user_metadata: metadata } }, error: null };
  } } }, from(table) {
    assert.equal(table, "app_users");
    return { select() { return this; }, in() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [{ id: "venue-user", role: "venue", email: "owner@example.invalid" }] }).then(resolve); } };
  } };
  const delivery = compile("src/lib/dancr/notification-delivery.ts", {
    "./venue-notification-preferences": preferences, "./customer-notification-preferences": customerPreferences,
    "./customer-notification-delivery": capability, "./public-app-url": { publicAppUrl: () => "https://example.invalid" },
  }, { fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ id: "11111111-1111-4111-8111-111111111111" }); } });
  const rows = [{ ...examples.pickupRequests, recipient_id: "venue-user", title: "Pickup", body: "Synthetic request" }];
  assert.deepEqual(plain(await delivery.deliverNotificationRows(client, rows)), { email: 1, push: 1 });
  metadata = { ...metadata, ...patchMetadata({ pickupRequests: false }) };
  assert.deepEqual(plain(await delivery.deliverNotificationRows(client, rows)), { email: 0, push: 0 });
  metadata = { ...metadata, ...patchMetadata({ pickupRequests: true, emailEnabled: false }) };
  assert.deepEqual(plain(await delivery.deliverNotificationRows(client, rows)), { email: 0, push: 1 });
  lookupError = true;
  assert.deepEqual(plain(await delivery.deliverNotificationRows(client, rows)), { email: 0, push: 0 });
  assert.equal(calls.length, 3);
});

test("muted inbox rows cannot hide an older allowed alert behind the page limit", async () => {
  const service = compile("src/lib/dancr/notifications.ts", { "./notification-icon": notificationIcons });
  const muted = Array.from({ length: 55 }, (_, id) => ({ id: String(id), notification_type: "shift_posted", payload: {} }));
  const rows = [...muted, { id: "visible", notification_type: "support_message", payload: {} }];
  const reads = [];
  const client = { from(table) {
    assert.equal(table, "notifications"); let first, last;
    return { select() { return this; }, eq(key, value) { assert.equal(key, "recipient_id"); assert.equal(value, "venue-user"); return this; },
      or() { return this; }, order() { return this; }, range(a, b) { first = a; last = b; reads.push([a, b]); return this; },
      then(resolve) { return Promise.resolve({ data: rows.slice(first, last + 1), error: null }).then(resolve); } };
  } };
  const result = await service.getUserNotifications(client, "venue-user", false, row => preferences.venueNotificationEnabled({}, row));
  assert.deepEqual(plain(result.map(row => row.id)), ["visible"]);
  assert.deepEqual(reads, [[0, 49], [50, 99]]);
  assert.equal(rows.length, 56);
});
