import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [middlewareSource, routeSource, helperSource, pageSource] =
  await Promise.all([
    readFile(new URL("../middleware.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/access/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/dancr/site-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/access/page.tsx", import.meta.url), "utf8"),
  ]);

test("the access gate protects pages without intercepting production APIs or auth callbacks", () => {
  assert.match(helperSource, /DANCR_SITE_ACCESS_GATE_ENABLED/);
  assert.match(middlewareSource, /api\(\?:\/\|\$\)/);
  assert.match(middlewareSource, /"\/auth\/callback"/);
  assert.match(middlewareSource, /"\/dmca"/);
  assert.match(middlewareSource, /safeSiteAccessReturnPath/);
  assert.match(middlewareSource, /cache-control", "private, no-store/);
});

test("access sessions are signed, expiring, HTTP-only, and resistant to open redirects", () => {
  assert.match(helperSource, /crypto\.subtle\.sign/);
  assert.match(helperSource, /crypto\.subtle\.verify/);
  assert.match(helperSource, /expiresAt > nowSeconds/);
  assert.match(helperSource, /candidate\.startsWith\("\/\/"\)/);
  assert.match(routeSource, /timingSafeEqual/);
  assert.match(routeSource, /httpOnly: true/);
  assert.match(routeSource, /sameSite: "lax"/);
  assert.match(routeSource, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(routeSource, /sameOriginRequest/);
});

test("failed access attempts use persistent shared rate limiting without storing raw IP addresses", () => {
  assert.match(routeSource, /createHmac\("sha256"/);
  assert.match(routeSource, /\.from\("admin_actions"\)/);
  assert.match(routeSource, /target_type", "site_access_gate"/);
  assert.match(routeSource, /site_access_blocked/);
  assert.match(routeSource, /RATE_LIMIT_WINDOW_SECONDS/);
  assert.doesNotMatch(routeSource, /ip_address/);
});

test("the gate page is a real production form and is excluded from search indexing", () => {
  assert.match(pageSource, /<AccessGateForm/);
  assert.match(pageSource, /robots: \{ index: false, follow: false \}/);
  assert.match(pageSource, /production site is currently limited to invited visitors/i);
});
