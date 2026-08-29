import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");

test("every application route receives the production security header baseline", () => {
  assert.match(nextConfig, /source: "\/:path\*"/);
  assert.match(nextConfig, /Content-Security-Policy[\s\S]*?base-uri 'self'; frame-ancestors 'none'; object-src 'none'/);
  assert.match(nextConfig, /Permissions-Policy[\s\S]*?camera=\(self\)[\s\S]*?microphone=\(self\)[\s\S]*?usb=\(\)/);
  assert.match(nextConfig, /Referrer-Policy[\s\S]*?strict-origin-when-cross-origin/);
  assert.match(nextConfig, /Strict-Transport-Security[\s\S]*?max-age=31536000/);
  assert.match(nextConfig, /X-Content-Type-Options[\s\S]*?nosniff/);
  assert.match(nextConfig, /X-Frame-Options[\s\S]*?DENY/);
  assert.match(nextConfig, /X-Permitted-Cross-Domain-Policies[\s\S]*?none/);
});
