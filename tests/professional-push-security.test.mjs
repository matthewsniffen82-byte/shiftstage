import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as preferences from "../src/lib/dancr/customer-notification-preferences.ts";
import * as venuePreferences from "../src/lib/dancr/venue-notification-preferences.ts";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";

const require = createRequire(import.meta.url);
const env = { NEXT_PUBLIC_ONESIGNAL_APP_ID: "synthetic-app", ONESIGNAL_REST_API_KEY: "synthetic-only-push-key", ONESIGNAL_SMS_FROM: "+17025550100" };
function compile(file, dependencies = {}, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Request, Response, URL, URLSearchParams, TextDecoder, Uint8Array, AbortSignal,
    process: { env }, console: { warn() {} },
    require: name => dependencies[name] ?? (name === "node:crypto" ? require(name) : {}),
    ...globals,
  });
  return exports;
}
const capability = compile("src/lib/dancr/customer-notification-delivery.ts");
const ownId = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
function deliveryFixture(role) {
  const calls = [];
  const service = compile("src/lib/dancr/notification-delivery.ts", {
    "./customer-notification-delivery": capability,
    "./customer-notification-preferences": preferences,
    "./venue-notification-preferences": venuePreferences,
    "./public-app-url": { publicAppUrl: () => "https://example.test" },
  }, { fetch: async (url, init) => {
    assert.equal(url, "https://api.onesignal.com/notifications");
    assert.equal(init.headers.Authorization, `Key ${env.ONESIGNAL_REST_API_KEY}`);
    calls.push(JSON.parse(init.body));
    return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
  } });
  const client = { auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: venuePreferences.venueNotificationMetadataPatch({ pushEnabled: true }) } }, error: null }) } }, from(table) {
    const data = table === "app_users" ? [{ id: ownId, role }] : [{ user_id: ownId, notification_settings: { pushEnabled: true } }];
    return { select() { return this; }, in() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); } };
  } };
  return { ...service, client, calls };
}
for (const role of ["customer", "dancer", "venue", "admin"]) {
  test(`${role} push delivery cannot target the public account UUID`, async () => {
    const f = deliveryFixture(role);
    const result = await f.deliverNotificationRows(f.client, [{ recipient_id: ownId, notification_type: "support_message", title: "Support", body: "Synthetic private reply" }], { email: false });
    assert.equal(result.push, 1);
    const alias = f.calls[0].include_aliases.external_id[0];
    assert.equal(f.calls[0].target_channel, "push");
    assert.equal(alias, capability.customerPushExternalId(ownId));
    assert.notEqual(alias, ownId);
    assert.notEqual(alias, capability.customerPushExternalId(otherId));
  });
}

test("shuttle push preserves a dashboard alert without guest contact, pickup data or private IDs", async () => {
  const f = deliveryFixture("venue");
  await f.deliverNotificationRows(f.client, [{ recipient_id: ownId, notification_type: "support_message", title: "MyDancr: free shuttle requested",
    body: "Guest Sample; 123 Private Hotel entrance; +17025550123; guest@example.test",
    payload: { kind: "club_shuttle_request", name: "Guest Sample", location: "123 Private Hotel entrance", phone: "+17025550123", email: "guest@example.test", venueId: otherId },
  }], { email: false });
  const payload = f.calls[0];
  assert.match(payload.contents.en, /shuttle/i);
  assert.equal(payload.url, "https://example.test/dashboard/venue");
  assert.deepEqual(payload.data, { kind: "club_shuttle_request" });
  assert.doesNotMatch(JSON.stringify(payload), /Guest Sample|Private Hotel|17025550123|guest@example.test|10000000-0000-4000/);
});

test("shuttle SMS constructs a generic dashboard alert even if a caller supplies guest details", async () => {
  const f = deliveryFixture("venue");
  assert.equal(await f.sendShuttlePhoneAlert({ phone: "+17025550101", requestId: "11111111-1111-4111-8111-111111111111", body: "Guest Sample; 123 Private Hotel entrance; guest@example.test" }), true);
  assert.match(f.calls[0].contents.en, /https:\/\/example.test\/dashboard\/venue/);
  assert.doesNotMatch(f.calls[0].contents.en, /Guest Sample|Private Hotel|guest@example.test/);
});

test("retired pickup chats never send external alerts", async () => {
  const f = deliveryFixture("customer");
  await f.deliverNotificationRows(f.client, [{ recipient_id: ownId, deliveryId: ownId,
    notification_type: "support_message", title: "New pickup message", body: "Private hotel and phone",
    payload: { kind: "club_pickup", pickupRequestId: otherId, guestKey: "private-return-secret", message: "Private chat text" },
  }], { email: false });
  assert.equal(f.calls.length, 0);
});

function notificationRoute(authenticated = true) {
  return compile("app/api/notifications/route.ts", {
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async (_request, access) => {
      assert.equal(access.active, true);
      if (!authenticated) throw new PublicApiError("AUTH_REQUIRED", "Sign in required.", 401);
      return { client: {}, user: { id: ownId } };
    } },
    "@/src/lib/dancr/customer-notification-delivery": capability,
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => ({ id: ownId, role: "venue" }) },
    "@/src/lib/dancr/venue-notification-preferences": venuePreferences,
    "@/src/lib/dancr/notifications": { getUserNotifications: async (_client, id) => { assert.equal(id, ownId); return []; } },
    "@/src/lib/api": { apiError: (error, fallback) => { const result = resolveApiError(error, fallback); return Response.json(result.body, { status: result.status }); } },
  });
}
test("notification enrollment capabilities belong only to the active verified caller", async () => {
  const response = await notificationRoute().GET(new Request(`https://example.test/api/notifications?userId=${otherId}&role=admin`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.notificationDelivery.pushExternalId, capability.customerPushExternalId(ownId));
  assert.notEqual(body.notificationDelivery.pushExternalId, capability.customerPushExternalId(otherId));
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
});
test("unauthenticated callers cannot obtain notification enrollment capabilities", async () => {
  const response = await notificationRoute(false).GET(new Request("https://example.test/api/notifications"));
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /pushExternalId|synthetic-only-push-key/);
});
