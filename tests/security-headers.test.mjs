import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");

test("every application route receives the production security header baseline", () => {
  assert.match(nextConfig, /source: "\/:path\*"/);
  assert.match(nextConfig, /default-src 'self'/);
  assert.match(nextConfig, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/raw\.githubusercontent\.com/);
  assert.match(nextConfig, /form-action 'self'/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(nextConfig, /frame-src 'self' https:\/\/www\.google\.com/);
  assert.match(nextConfig, /object-src 'none'/);
  assert.match(nextConfig, /script-src 'self' 'unsafe-inline'/);
  assert.match(nextConfig, /script-src-attr 'none'/);
  assert.match(nextConfig, /upgrade-insecure-requests/);
  assert.match(nextConfig, /Cross-Origin-Opener-Policy[\s\S]*?same-origin-allow-popups/);
  assert.match(nextConfig, /Origin-Agent-Cluster[\s\S]*?\?1/);
  assert.match(nextConfig, /Permissions-Policy[\s\S]*?camera=\(self\)[\s\S]*?microphone=\(self\)[\s\S]*?usb=\(\)/);
  assert.match(nextConfig, /Referrer-Policy[\s\S]*?strict-origin-when-cross-origin/);
  assert.match(nextConfig, /Strict-Transport-Security[\s\S]*?max-age=31536000/);
  assert.match(nextConfig, /X-Content-Type-Options[\s\S]*?nosniff/);
  assert.match(nextConfig, /X-DNS-Prefetch-Control[\s\S]*?off/);
  assert.match(nextConfig, /X-Frame-Options[\s\S]*?DENY/);
  assert.match(nextConfig, /X-Permitted-Cross-Domain-Policies[\s\S]*?none/);
  assert.match(nextConfig, /poweredByHeader: false/);
});

test("API responses default to no-store at the edge", () => {
  assert.match(nextConfig, /source: "\/api\/:path\*"[\s\S]*?Cache-Control[\s\S]*?no-store/);
});
