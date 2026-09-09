import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
import { requireSameOriginJsonMutation } from "../src/lib/security/browser-mutation.ts";
import { requestRoleFixture } from "./helpers/request-role-fixture.mjs";

const require = createRequire(import.meta.url);
const origin = "https://www.mydancr.com";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const routes = [
  ["customer/going", { shiftId: id, going: false }],
  ["public/media-likes", { mediaType: "photo", mediaId: id, liked: false }],
  ["public/engagement-shares", { targetType: "profile", targetId: id }],
];
const rejected = [
  ["sibling-origin form", { origin: "https://untrusted.mydancr.com", "sec-fetch-site": "same-site", "content-type": "text/plain" }, 403],
  ["cross-site form", { origin: "https://example.test", "sec-fetch-site": "cross-site", "content-type": "text/plain" }, 403],
  ["cross-origin JSON", { origin: "https://example.test", "content-type": "application/json" }, 403],
  ["opaque-origin JSON", { origin: "null", "content-type": "application/json" }, 403],
  ["cross-site metadata", { "sec-fetch-site": "cross-site", "content-type": "application/json" }, 403],
  ["same-site metadata", { "sec-fetch-site": "same-site", "content-type": "application/json" }, 403],
  ["plain JSON without origin", { "content-type": "text/plain" }, 415],
  ["form media type", { "content-type": "application/x-www-form-urlencoded" }, 415],
  ["missing JSON media type", {}, 415],
];
function loadRoute(path) {
  const calls = [], exports = {};
  const code = ts.transpileModule(readFileSync(`app/api/${path}/route.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Request, Response, URL, Error, console: { warn() {}, error() {} }, require(name) {
    if (name === "next/server" || name === "node:crypto") return require(name);
    if (name === "@/src/lib/security/browser-mutation") return { requireSameOriginJsonMutation };
    if (name === "@/src/lib/bounded-json-body") return { readBoundedJsonObject };
    if (name === "@/src/lib/supabase/admin") return { createAdminSupabaseClient() { calls.push("database"); throw new Error("Unexpected database work"); } };
    if (name === "@/src/lib/dancr/public-request-rate-limit") return { PublicRequestRateLimitError: class extends Error {} };
    if (name === "@/src/lib/api") return { apiError(error, fallback) { const result = resolveApiError(error, fallback); return Response.json(result.body, { status: result.status }); } };
    return {};
  } });
  return { handler: exports.POST, calls };
}
for (const [path, body] of routes) for (const [label, headers, status] of rejected) test(`${path} rejects ${label} before body or database work`, async () => {
  const { handler, calls } = loadRoute(path);
  // The padding represents the '=' inserted by an enctype=text/plain form.
  const request = new Request(`${origin}/api/${path}`, { method: "POST", headers: { cookie: "dancr_going_visitor=" + "x".repeat(43) + "; dancr_media_like_visitor=" + "x".repeat(43), ...headers }, body: JSON.stringify({ ...body, padding: "=" }) + "\r\n" });
  const response = await handler(request);
  assert.equal(response.status, status);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual(calls, []);
});
for (const base of [origin, "https://mydancr.com", "https://shiftstage-example.vercel.app", "http://localhost:3000"]) test(`JSON mutations accept their own origin at ${base}`, () => {
  for (const headers of [{ origin: base, "sec-fetch-site": "same-origin" }, { origin: base }, { "sec-fetch-site": "same-origin" }, {}])
    assert.doesNotThrow(() => requireSameOriginJsonMutation(new Request(`${base}/api/public/media-likes`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8", ...headers } })));
});
for (const [path] of routes) test(`${path} preserves same-origin request validation`, async () => {
  const { handler, calls } = loadRoute(path);
  const response = await handler(new Request(`${origin}/api/${path}`, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

for (const headers of [
  { cookie: "access_token=synthetic; refresh_token=synthetic" },
  { cookie: "dancr_going_visitor=" + "x".repeat(43) },
  { cookie: "mydancr_nfc_account_v1=synthetic", "x-dancr-refresh-token": "synthetic" },
  { "x-dancr-refresh-token": "synthetic" },
]) test("ambient cookies or a refresh token alone never authenticate an account mutation", async () => {
  const fixture = requestRoleFixture();
  await assert.rejects(fixture.createContext(new Request(`${origin}/api/account`, { method: "PATCH", headers }), { active: true }), /Sign in required/);
  assert.deepEqual(fixture.calls, []);
});
