import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as preferences from "../src/lib/dancr/customer-notification-preferences.ts";
import * as venueSharing from "../src/lib/dancr/venue-customers.ts";
import * as policy from "../src/lib/api-error-policy.ts";
import * as bounded from "../src/lib/bounded-json-body.ts";
import * as mutation from "../src/lib/security/browser-mutation.ts";
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function compile(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Request, Response, URL, URLSearchParams, TextDecoder, Error,
    require: name => name === "server-only" ? {} : name === "next/server" ? require(name) : dependencies[name],
  });
  return exports;
}
const consent = compile("src/lib/dancr/customer-email-consent.ts", { "../api-error-policy": policy, "./customer-notification-preferences": preferences, "./venue-customers": venueSharing });
const version = preferences.CUSTOMER_EMAIL_CONSENT_VERSION;
const token = "a".repeat(64);
test("signup records only a literal opt-in to the current consent wording", async () => {
  const calls = [], nonce = "11111111-1111-4111-8111-111111111111";
  const admin = { rpc: async (...args) => { calls.push(plain(args)); return { data: nonce }; } };
  for (const input of [{}, { customerEmailOptIn: false }]) assert.equal(await consent.prepareCustomerEmailSignup(admin, "a@b.test", input), null);
  for (const input of [{ customerEmailOptIn: "true" }, { customerEmailOptIn: true }, { customerEmailOptIn: true, customerEmailConsentVersion: "old" }])
    await assert.rejects(consent.prepareCustomerEmailSignup(admin, "a@b.test", input), error => error.status === 400);
  assert.equal(calls.length, 0);
  assert.equal(await consent.prepareCustomerEmailSignup(admin, "a@b.test", { customerEmailOptIn: true, customerEmailConsentVersion: version }), nonce);
  assert.deepEqual(calls, [["prepare_customer_signup_choices", { p_email: "a@b.test", p_version: version, p_follow: false, p_marketing: true, p_venue_id: null, p_venue_name: null, p_name: null, p_city: "" }]]);
  await assert.rejects(consent.prepareCustomerEmailSignup({ rpc: async () => ({ error: new Error("offline") }) }, "a@b.test", { customerEmailOptIn: true, customerEmailConsentVersion: version }), error => error.status === 503);
});
test("old clients can unsubscribe but cannot subscribe without current explicit consent", async () => {
  const calls = [];
  const admin = { rpc: async (name, args) => { calls.push([name, plain(args)]); return { data: { userId: "customer", notificationSettings: { emailEnabled: args.p_enabled } } }; } };
  await consent.setCustomerEmailPreference(admin, "customer", false);
  assert.equal(calls[0][1].p_source, "legacy_preferences");
  assert.equal(calls[0][0], "set_customer_email_preference", "old unsubscribe requests still withdraw both categories");
  for (const [source, v] of [[undefined, undefined], ["legacy_preferences", version], ["invented", version], ["account_preferences", "old"]])
    await assert.rejects(consent.setCustomerEmailPreference(admin, "customer", true, source, v), error => error.status === 400);
  assert.equal(calls.length, 1);
  await consent.setCustomerEmailPreference(admin, "customer", true, "account_preferences", version);
  assert.deepEqual(calls[1][1], { p_user_id: "customer", p_channel: "marketing", p_enabled: true, p_source: "account_preferences", p_version: version });
  await assert.rejects(consent.setCustomerEmailPreference({ rpc: async () => ({ data: { userId: "other" } }) }, "customer", false), error => error.status === 503);
});

test("signup passes only individually checked choices and never shares details from unchecked fields",async()=>{
  const calls=[],nonce="11111111-1111-4111-8111-111111111111";
  const admin={rpc:async(name,args)=>{calls.push(plain(args));return {data:nonce};}};
  const input={customerEmailConsentVersion:version,customerFollowEmailOptIn:true,customerVenueId:nonce,customerVenueName:"Named Club",customerShareName:"My Name",customerShareCity:"Las Vegas",customerVenueShareVersion:venueSharing.VENUE_SHARING_CONSENT_VERSION};
  await consent.prepareCustomerEmailSignup(admin,"a@example.test",input);
  assert.equal(calls[0].p_follow,true);assert.equal(calls[0].p_marketing,false);assert.equal(calls[0].p_venue_id,null);assert.equal(calls[0].p_name,null);
  await consent.prepareCustomerEmailSignup(admin,"a@example.test",{...input,customerVenueShareOptIn:true});
  assert.equal(calls[1].p_venue_id,nonce);assert.equal(calls[1].p_name,"My Name");
  await assert.rejects(()=>consent.prepareCustomerEmailSignup(admin,"a@example.test",{...input,customerVenueShareOptIn:true,customerShareName:"x"}),e=>e.status===400);
  await assert.rejects(()=>consent.prepareCustomerEmailSignup(admin,"a@example.test",{...input,customerFollowEmailOptIn:"true"}),e=>e.status===400);
});
function routeFixture(result = { data: { active: false } }) {
  const calls = [];
  const route = compile("app/api/public/customer-email/route.ts", {
    "@/src/lib/api": { PublicApiError: policy.PublicApiError, apiError(error, fallback) { const resolved = policy.resolveApiError(error, fallback); return Response.json(resolved.body, { status: resolved.status }); } },
    "@/src/lib/bounded-json-body": bounded,
    "@/src/lib/security/browser-mutation": mutation,
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ rpc: async (...args) => { calls.push(plain(args)); return result; } }) },
  });
  return { ...route, calls };
}
const request = (body, extra = {}) => new Request("https://mydancr.com/api/public/customer-email", { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
test("anonymous preference reads do not unsubscribe and reveal no customer identity", async () => {
  const f = routeFixture({ data: { active: true, email: "private@example.test" } });
  const response = await f.POST(request({ token, action: "read" }));
  assert.equal(f.GET, undefined, "GET scanner requests cannot unsubscribe");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, active: true });
  assert.deepEqual(f.calls, [["manage_customer_email_preference", { p_token: token, p_unsubscribe: false }]]);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await f.POST(request({ token, action: "unsubscribe" }))).status, 200);
  assert.equal(f.calls[1][1].p_unsubscribe, true);
});
test("mailbox one-click POST works without cookies or same-origin credentials", async () => {
  const f = routeFixture();
  const response = await f.POST(new Request("https://mydancr.com/api/public/customer-email?token=" + token, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://mail.example.test" }, body: "List-Unsubscribe=One-Click",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, active: false });
  assert.equal(f.calls[0][1].p_unsubscribe, true);
});
test("malformed, cross-site and oversized unsubscribe requests fail before database access", async () => {
  const f = routeFixture();
  const requests = [request({ token: "short", action: "unsubscribe" }), request({ token, action: "subscribe" }),
    request({ token, action: "read" }, { origin: "https://other.test" }), request({ token, action: "read", padding: "x".repeat(1100) }),
    new Request("https://mydancr.com/api/public/customer-email?token=" + token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click&extra=true" })];
  for (const input of requests) assert.ok((await f.POST(input)).status >= 400);
  assert.equal(f.calls.length, 0);
});
test("expired links and storage failure never claim unsubscribe success", async () => {
  for (const [result, status] of [[{ error: { code: "P0002" } }, 404], [{ error: new Error("private database detail") }, 500], [{ data: {} }, 500]]) {
    const response = await routeFixture(result).POST(request({ token, action: "unsubscribe" }));
    assert.equal(response.status, status);
    const body = await response.json(); assert.equal(body.ok, false);
    assert.doesNotMatch(body.error, /private database detail/);
  }
});
test("signup email choice is unchecked, optional, separate from required terms and matches the archived wording", () => {
  const field = read("src/live-shell/shell.html").match(/<label[^>]*id="customerEmailOptInField"[\s\S]*?<\/label>/)?.[0];
  assert.ok(field); assert.doesNotMatch(field, /\b(?:checked|required)(?:\s|=|>)/);
  assert.ok(field.includes(preferences.CUSTOMER_EMAIL_CONSENT_TEXT));
  assert.ok(field.includes(`data-consent-version="${version}"`));
  assert.ok(read("supabase/migrations/20261025060937_customer_signup_choices.sql").includes(preferences.CUSTOMER_EMAIL_CONSENT_TEXT));
});
