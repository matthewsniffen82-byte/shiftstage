import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../src/lib/security/document-content-security-policy.mjs";
import { androidDeviceClassScript } from "../src/lib/security/android-device-script.mjs";
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const code = ts.transpileModule(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  const exports = {}, calls = [];
  vm.runInNewContext(code, { exports, Headers, require(name) {
    if (name === "next/server") return { NextResponse };
    if (name.includes("document-content-security-policy")) return policy;
    return { SESSION_RESPONSE_HEADERS: {}, async refreshExpiringRequestSession() { calls.push("auth"); return null; } };
  } });
  return { exports, calls };
}
for (const pathname of ["/admin", "/admin/operations", "/dashboard/dancer", "/dashboard/dancer/tv", "/dashboard/customer/saved", "/dashboard/venue", "/dashboard/agent", "/account?venue_nfc=synthetic", "/account/reset-password"]) test(`${pathname} receives a fresh policy without permitting arbitrary inline scripts`, async () => {
  const f = fixture();
  const request = () => new NextRequest("https://www.mydancr.com" + pathname, { headers: {
    "content-security-policy": "script-src 'unsafe-inline' 'nonce-attacker'", "x-nonce": "attacker", authorization: "Bearer synthetic",
  } });
  const first = await f.exports.middleware(request()), second = await f.exports.middleware(request());
  const csp = first.headers.get("content-security-policy") || "";
  const nonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(nonce && nonce.length >= 32);
  assert.notEqual(csp, second.headers.get("content-security-policy"));
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline|nonce-attacker/);
  assert.equal(first.headers.get("x-middleware-request-content-security-policy"), csp);
  assert.equal(first.headers.get("x-middleware-request-x-nonce"), nonce);
  assert.match(first.headers.get("cache-control"), /private, no-store/);
  for (const header of ["cdn-cache-control", "vercel-cdn-cache-control"]) assert.equal(first.headers.get(header), "no-store");
  assert.deepEqual(f.calls, [], "HTML policy generation does not alter API authentication");
});
for (const pathname of ["/", "/dancers/synthetic", "/api/public/discovery", "/accounting", "/administrator", "/dashboard-old", "/admin/security-fixture-missing", "/dashboard/missing", "/account/missing"]) test(`${pathname} keeps its existing public/cache policy`, async () => {
  const f = fixture(), response = await f.exports.middleware(new NextRequest("https://www.mydancr.com" + pathname, { headers: { authorization: "Bearer synthetic" } }));
  assert.equal(response.headers.get("content-security-policy"), null);
  assert.equal(response.headers.get("cache-control"), null);
  assert.deepEqual(f.calls, []);
});

test("every existing private document page is covered and renders per request", () => {
  for (const area of ["admin", "dashboard", "account"]) {
    const directory = new URL("../app/" + area + "/", import.meta.url);
    for (const entry of readdirSync(directory, { recursive: true }).map(String).map(path => path.replaceAll("\\", "/"))) {
      if (!/(?:^|\/)page\.tsx$/.test(entry)) continue;
      const path = "/" + area + (entry === "page.tsx" ? "" : "/" + entry.slice(0, -"/page.tsx".length));
      assert.ok(policy.isPrivateDocumentPath(path), path + " requires CSP review when introduced");
      assert.match(readFileSync(new URL(entry, directory), "utf8"), /export const dynamic = "force-dynamic"/);
      assert.ok(policy.isPrivateDocumentPath(path + "/"));
    }
  }
});
test("private policy preserves required resources and permits only the fixed device script by hash", async () => {
  const { policy: csp } = await policy.createPrivateDocumentPolicy();
  const hash = createHash("sha256").update(androidDeviceClassScript).digest("base64");
  assert.ok(csp.includes("'sha256-" + hash + "'"));
  for (const directive of policy.contentSecurityPolicy.split("; ").filter(value => !value.startsWith("script-src "))) assert.ok(csp.split("; ").includes(directive));
  assert.doesNotMatch(csp, /sha256-invalid/);
});
