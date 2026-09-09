import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { contentSecurityPolicy } from "../src/lib/security/document-content-security-policy.mjs";
import {
  createRootContentSecurityPolicy,
  sha256Source,
} from "../src/lib/security/root-content-security-policy.mjs";

const [nextConfig, rootRoute] = await Promise.all([
  readFile(new URL("../next.config.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
]);

test("every application route receives the production security header baseline", () => {
  assert.match(nextConfig, /import \{ contentSecurityPolicy \} from "\.\/src\/lib\/security\/document-content-security-policy\.mjs"/);
  const baseline = nextConfig + "\n" + contentSecurityPolicy;
  assert.match(baseline, /source: "\/:path\*"/);
  assert.match(baseline, /default-src 'self'/);
  assert.match(baseline, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/);
  assert.doesNotMatch(baseline, /raw\.githubusercontent\.com/);
  assert.match(baseline, /form-action 'self'/);
  assert.match(baseline, /frame-ancestors 'none'/);
  assert.match(baseline, /frame-src 'self' https:\/\/www\.google\.com/);
  assert.match(baseline, /object-src 'none'/);
  assert.match(baseline, /script-src 'self' 'unsafe-inline'/);
  assert.match(baseline, /script-src-attr 'none'/);
  assert.match(baseline, /font-src 'self' data: https:\/\/fonts\.gstatic\.com/);
  assert.match(baseline, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(baseline, /upgrade-insecure-requests/);
  assert.match(baseline, /Cross-Origin-Opener-Policy[\s\S]*?same-origin-allow-popups/);
  assert.match(baseline, /Origin-Agent-Cluster[\s\S]*?\?1/);
  assert.match(baseline, /Permissions-Policy[\s\S]*?camera=\(self\)[\s\S]*?microphone=\(self\)[\s\S]*?usb=\(\)/);
  assert.match(baseline, /Referrer-Policy[\s\S]*?strict-origin-when-cross-origin/);
  assert.match(baseline, /Strict-Transport-Security[\s\S]*?max-age=31536000/);
  assert.match(baseline, /X-Content-Type-Options[\s\S]*?nosniff/);
  assert.match(baseline, /X-DNS-Prefetch-Control[\s\S]*?off/);
  assert.match(baseline, /X-Frame-Options[\s\S]*?DENY/);
  assert.match(baseline, /X-Permitted-Cross-Domain-Policies[\s\S]*?none/);
  assert.match(baseline, /X-XSS-Protection[\s\S]*?value: "0"/);
  assert.match(baseline, /poweredByHeader: false/);
});

test("API responses default to no-store at the edge", () => {
  assert.match(nextConfig, /source: "\/api\/:path\*"[\s\S]*?Cache-Control[\s\S]*?no-store/);
  assert.match(nextConfig, /const apiContentSecurityPolicy = \[[\s\S]*?default-src 'none'[\s\S]*?frame-ancestors 'none'/);
  assert.match(nextConfig, /source: "\/api\/:path\*"[\s\S]*?Content-Security-Policy[\s\S]*?apiContentSecurityPolicy/);
});

test("the cached production home shell allowlists exact inline scripts without unsafe-inline", () => {
  const trustedOne = "document.documentElement.dataset.ready = 'true';";
  const trustedTwo = "console.log('trusted');";
  const policy = createRootContentSecurityPolicy(
    `<html><script>${trustedOne}</script><script src="/app.js"></script><script>${trustedTwo}</script></html>`,
  );

  assert.match(policy, /script-src 'self'/);
  assert.ok(policy.includes(sha256Source(trustedOne)));
  assert.ok(policy.includes(sha256Source(trustedTwo)));
  assert.ok(!policy.includes(sha256Source("console.log('injected');")));
  assert.doesNotMatch(policy.match(/script-src [^;]+/)?.[0] || "", /unsafe-inline/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(rootRoute, /createRootContentSecurityPolicy\(withVersionedAssets\)/);
  assert.match(rootRoute, /"content-security-policy": contentSecurityPolicy/);
  assert.match(nextConfig, /source: "\/"[\s\S]*?Content-Security-Policy[\s\S]*?rootContentSecurityPolicy/);
});
