import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
    if (name.endsWith("/site-lock")) return { enforceSiteLock: async () => null, siteLockEnabled: () => false };
    if (name.includes("document-content-security-policy")) return policy;
    return { SESSION_RESPONSE_HEADERS: {}, async refreshExpiringRequestSession() { calls.push("auth"); return null; } };
  } });
  return { exports, calls };
}
for (const pathname of ["/admin", "/admin/operations", "/guides", "/dashboard/dancer", "/dashboard/dancer/tv", "/dashboard/customer/saved", "/dashboard/venue", "/account?venue_nfc=synthetic", "/account/reset-password",
  "/dashboard/vip", "/vip", "/vip/invite/synthetic", "/vip/invite/synthetic/", "/internal", "/internal/club/synthetic", "/internal/sign/synthetic", "/internal/tap/synthetic", "/internal/tap/synthetic/", "/internal/follow-return?state=synthetic",
]) test(`${pathname} receives a fresh policy without permitting arbitrary inline scripts`, async () => {
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
for (const pathname of ["/", "/dancers/synthetic", "/api/public/discovery", "/accounting", "/administrator", "/dashboard-old", "/admin/security-fixture-missing", "/guides/missing", "/dashboard/missing", "/dashboard/agent", "/account/missing",
  "/vip/missing", "/vip/invite", "/vip/invite/synthetic/extra", "/internal/missing", "/internal/club", "/internal/sign", "/internal/tap", "/internal/tap/synthetic/extra", "/internal/club/synthetic/extra", "/internalized", "/internal/profile-viewer",
]) test(`${pathname} keeps its existing public/cache policy`, async () => {
  const f = fixture(), response = await f.exports.middleware(new NextRequest("https://www.mydancr.com" + pathname, { headers: { authorization: "Bearer synthetic" } }));
  assert.equal(response.headers.get("content-security-policy"), null);
  assert.equal(response.headers.get("cache-control"), null);
  assert.deepEqual(f.calls, []);
});

test("the retired Agent dashboard has no page or client entry point", () => {
  assert.equal(existsSync(new URL("../app/dashboard/agent/page.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/dashboard/agent/AgentDashboardClient.tsx", import.meta.url)), false);
});

test("every existing private document page is covered and renders per request", () => {
  for (const area of ["admin", "guides", "dashboard", "account", "vip", "internal"]) {
    const directory = new URL("../app/" + area + "/", import.meta.url);
    for (const entry of readdirSync(directory, { recursive: true }).map(String).map(path => path.replaceAll("\\", "/"))) {
      if (!/(?:^|\/)page\.tsx$/.test(entry)) continue;
      const path = ("/" + area + (entry === "page.tsx" ? "" : "/" + entry.slice(0, -"/page.tsx".length)))
        .replace(/\[token\]/g, "synthetic");
      assert.ok(policy.isPrivateDocumentPath(path), path + " requires CSP review when introduced");
      const renderingSources = [readFileSync(new URL(entry, directory), "utf8")];
      // A server layout can opt its client-only descendant pages into dynamic rendering.
      const segments = entry.split("/").slice(0, -1);
      for (let depth = 0; depth <= segments.length; depth++) {
        const layout = new URL([...segments.slice(0, depth), "layout.tsx"].join("/"), directory);
        if (existsSync(layout)) renderingSources.push(readFileSync(layout, "utf8"));
      }
      assert.ok(renderingSources.some(source => /export const dynamic = "force-dynamic"/.test(source)), path + " must render per request");
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
