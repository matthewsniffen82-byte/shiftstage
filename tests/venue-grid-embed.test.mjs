import { canonicalVenueSlug } from "../src/lib/dancr/venue-branding.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import pathToRegexpModule from "next/dist/compiled/path-to-regexp/index.js";
import nextConfig from "../next.config.mjs";
import { parseDiscoveryCursor } from "../src/lib/dancr/discovery-pagination.ts";
import { venueEmbedPolicy, nonEmbedDocumentSource } from "../src/lib/security/venue-embed-policy.mjs";
import { versionStaticAssetReferences } from "../src/lib/dancr/static-asset-cache.mjs";
import { venueEmbedAccent } from "../src/lib/dancr/venue-embed-theme.mjs";
import { isActiveNfcPresence } from "../src/lib/dancr/shift-presence.ts";
import * as embedMedia from "../src/lib/dancr/venue-embed-media.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { pathToRegexp } = pathToRegexpModule;
function loadTs(path, dependencies) {
  const exports = {};
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, Request, Response, URL, require(name) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  } });
  return exports;
}
const venue = { id: "venue-one", slug: "echo-house", name: "Echo House", city: "Las Vegas" };
const dancer = { id: "one", slug: "ty", stageName: "Ty", venueId: venue.id, primaryPhotoUrl: "https://images.example/photo.jpg", primaryPhotoSrcSet: null };
class RateLimit extends Error { retryAfterSeconds = 60; }
function apiFixture(options = {}) {
  const calls = [];
  const location = options.venue || venue;
  const route = loadTs("app/api/public/venue-grid/[slug]/route.ts", {
    "next/server": { NextResponse: Response },
    "@/src/lib/api": { apiError: (error, fallback, status) => Response.json({ ok: false, error: fallback }, { status: error.status || status }) },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/public": { getVenueProfile: async (_client, slug) => { assert.equal(slug, location.slug); return options.missing ? null : location; } },
    "@/src/lib/dancr/discovery-pagination": { parseDiscoveryCursor },
    "@/src/lib/dancr/venue-guest-colors": { getVenueGuestColors: async (_client, venueId) => { assert.equal(venueId, location.id); return options.colors || { internalAccent: null, embedAccent: null, configured: false }; } },
    "@/src/lib/dancr/venue-embed-media.mjs": embedMedia,
    "@/src/lib/dancr/public-request-rate-limit": { PublicRequestRateLimitError: RateLimit },
    "@/src/lib/dancr/public-directory": { getRankedDirectoryPage: async (_client, _request, scope) => {
      calls.push(scope); if (options.error) throw options.error;
      return options.page || { dancers: [dancer], tonightDancers: [dancer], nextCursor: null };
    } },
  });
  return { calls, get: query => route.GET(new Request(`https://www.mydancr.com/api/public/venue-grid/${location.slug}${query || ""}`), { params: Promise.resolve({ slug: location.slug }) }) };
}

test("embed API locks venue, city and Working Now even when query filters are tampered with", async () => {
  const other = { ...dancer, id: "other", venueId: "another-club" };
  const offline = { ...dancer, id: "offline" };
  const fixture = apiFixture({ page: { dancers: [{ ...dancer, shiftEndsAt: "private deadline", socialLinks: ["private"] }, other, offline], tonightDancers: [dancer, other], nextCursor: "next" } });
  const response = await fixture.get("?city=Miami&venue=another-club&filter=all&scope=all");
  assert.equal(JSON.stringify(fixture.calls), JSON.stringify([{ city: "Las Vegas", venueId: venue.id, filter: "now", cursor: "" }]));
  const body = await response.json();
  assert.deepEqual(body.dancers, [{ id: dancer.id, slug: dancer.slug, stageName: dancer.stageName, primaryPhotoUrl: dancer.primaryPhotoUrl, primaryPhotoSrcSet: null }]);
  assert.equal(body.nextCursor, "next");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("unavailable clubs, invalid city cursors and rate limits never fall back to another feed", async () => {
  const missing = apiFixture({ missing: true });
  assert.equal((await missing.get()).status, 404);
  assert.equal(missing.calls.length, 0);
  const invalid = apiFixture();
  assert.equal((await invalid.get(`?cursor=directory2:Miami:${randomUUID()}:100`)).status, 400);
  assert.equal(invalid.calls.length, 0);
  const limited = await apiFixture({ error: new RateLimit() }).get();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("saved embed colors exclude the internal color and resetting overrides old links", async () => {
  const configured = await apiFixture({ colors: { internalAccent: "#ff0000", embedAccent: "#00aaff", configured: true } }).get("?accent=ffffff");
  const data = await configured.json();
  assert.equal(data.venue.embedAccent, "#00aaff");
  assert.equal(JSON.stringify(data).includes("#ff0000"), false);
  const reset = await apiFixture({ colors: { internalAccent: "#ff0000", embedAccent: null, configured: true } }).get("?accent=ffffff");
  assert.equal((await reset.json()).venue.embedAccent, "#7c3aed");
  assert.equal((await (await apiFixture().get()).json()).venue.embedAccent, null);
});

test("only the exact embed document path is exempt from DENY and gets public-only CSP", async () => {
  const matcher = pathToRegexp(nonEmbedDocumentSource);
  for (const path of ["/", "/dashboard", "/dancers/ty", "/api/public/venue-grid/echo-house", "/embed/venues/echo-house/settings", "/embed/venues/"]) assert.ok(matcher.test(path), path);
  assert.equal(matcher.test("/embed/venues/echo-house"), false);
  assert.equal(matcher.test("/embed/venues/echo-house/"), false);
  const rules = await nextConfig.headers();
  assert.equal(rules.find(rule => rule.source === "/:path*").headers.some(header => header.key === "X-Frame-Options"), false);
  assert.equal(rules.find(rule => rule.source === nonEmbedDocumentSource).headers[0].value, "DENY");
  const route = loadTs("app/embed/venues/[slug]/route.ts", {
    "@/src/lib/dancr/static-asset-cache.mjs": { versionStaticAssetReferences },
    "@/src/lib/dancr/venue-branding": { canonicalVenueSlug },
    "@/src/lib/security/venue-embed-policy.mjs": { venueEmbedPolicy },
    "@/src/lib/dancr/venue-embed-theme.mjs": { venueEmbedAccent },
  });
  const response = await route.GET(new Request("https://www.mydancr.com/embed/venues/echo-house"), { params: Promise.resolve({ slug: venue.slug }) });
  assert.equal(response.headers.get("content-security-policy"), venueEmbedPolicy);
  assert.match(venueEmbedPolicy, /frame-ancestors 'self' https:/);
  assert.doesNotMatch(venueEmbedPolicy, /unsafe-inline/);
  const html = await response.text();
  assert.match(html, /data-venue-slug="echo-house"/);
  const rhino = await route.GET(new Request("https://www.mydancr.com/embed/venues/spearmint-rhino-las-vegas-demo"), { params: Promise.resolve({ slug: "spearmint-rhino-las-vegas-demo" }) });
  assert.match(await rhino.text(), /data-venue-slug="talk-of-the-town"/);
  assert.match(html, /home-dancer-grid home-dancer-three-column/);
  assert.match(html, /dancer-grid-card\.js/);
  assert.doesNotMatch(html, /live-shell\.js|<form|localStorage/);
  for (const slug of ['a" onload="alert(1)', "../dashboard"]) assert.equal((await route.GET(null, { params: Promise.resolve({ slug }) })).status, 404);
});

function runtime() {
  const window = { location: { origin: "https://www.mydancr.com" }, crypto: { randomUUID } };
  const context = vm.createContext({ window, URL, AbortSignal });
  vm.runInContext(read("public/dancer-grid-card.js"), context);
  vm.runInContext(read("public/venue-grid-embed.js"), context);
  return window;
}

test("embed cards use the shared homepage renderer, escape content and open full profiles safely", () => {
  const window = runtime();
  const html = window.MydancrVenueEmbed.cardMarkup({ ...dancer, stageName: '<img onerror="bad">', primaryPhotoUrl: "javascript:alert(1)" }, { name: "<club>" }, 0);
  assert.match(html, /href="\/dancers\/ty" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /is-now is-compact-directory/);
  assert.match(html, /&lt;img onerror=&quot;bad&quot;&gt;/);
  assert.match(html, /&lt;club&gt;/);
  assert.doesNotMatch(html, /<img|javascript:/);
  const noPhoto = window.MydancrVenueEmbed.cardMarkup({ ...dancer, primaryPhotoUrl: null }, venue, 0);
  assert.doesNotMatch(noPhoto, /<img/);
  const first = window.MydancrVenueEmbed.cardMarkup(dancer, venue, 0);
  const later = window.MydancrVenueEmbed.cardMarkup(dancer, venue, 12);
  assert.match(first, /loading="eager" fetchpriority="high"/);
  assert.match(later, /loading="lazy" fetchpriority="auto"/);
  assert.match(read("src/live-shell/app/19-reset-home-discovery-feed-qr-prompt.js"), /window\.MydancrDancerGrid\.render/);
});

function componentFixture() {
  const window = runtime(), nodes = new Map(), requests = [], timers = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", innerHTML: "", hidden: false, listeners: {},
      focus() {}, close() {}, showModal() {},
      addEventListener(event, handler) { this.listeners[event] = handler; }, setAttribute() {}, querySelectorAll() { return []; } });
    return nodes.get(id);
  };
  const styles = new Map();
  const document = { hidden: false, body: { dataset: { venueSlug: venue.slug, accent: "#c99842" }, style: { setProperty: (key, value) => styles.set(key, value) } }, getElementById: node, listeners: {},
    addEventListener(event, handler) { this.listeners[event] = handler; } };
  let responder = () => ({ ok: true, venue, dancers: [dancer], nextCursor: "page-two" });
  window.fetch = async (url, options) => { requests.push({ url, options }); return Response.json(await responder(url, options)); };
  window.scrollTo = () => {};
  window.setInterval = (handler, delay) => { timers.push({ handler, delay }); };
  return { window, document, node, requests, timers, styles, respond: fn => { responder = fn; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("an existing embed adopts saved Admin colors on load and refresh without replacing its link", async () => {
  const f = componentFixture();
  f.respond(() => ({ ok: true, venue: { ...venue, embedAccent: "#00aaff" }, dancers: [dancer], nextCursor: null }));
  await f.window.MydancrVenueEmbed.mount(f.document);
  assert.equal(f.styles.get("--embed-accent"), "#00aaff");
  f.respond(() => ({ ok: true, venue: { ...venue, embedAccent: "#7c3aed" }, dancers: [dancer], nextCursor: null }));
  f.timers[0].handler(); await settle();
  assert.equal(f.styles.get("--embed-accent"), "#7c3aed");
  assert.ok(f.requests.every(request => request.url.includes(`/venue-grid/${venue.slug}`)));
});

test("widget paginates without cookies and refreshes all loaded pages with a new placement visit", async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  assert.match(f.node("results").innerHTML, /data-public-dancer-id="one"/);
  const visit = f.requests[0].options.headers["x-discovery-visit"];
  f.respond(() => ({ ok: true, venue, dancers: [{ ...dancer, id: "two" }], nextCursor: null }));
  await f.node("venue-more").listeners.click();
  assert.match(f.requests[1].url, /cursor=page-two/);
  assert.equal(f.requests[1].options.headers["x-discovery-visit"], visit);
  assert.match(f.node("results").innerHTML, /data-public-dancer-id="two"/);
  f.respond(url => ({ ok: true, venue, dancers: url.includes("cursor=") ? [{ ...dancer, id: "new" }] : [], nextCursor: url.includes("cursor=") ? null : "page-two" }));
  await f.node("venue-refresh").listeners.click();
  assert.equal(f.requests.length, 4);
  assert.notEqual(f.requests[2].options.headers["x-discovery-visit"], visit);
  assert.match(f.node("results").innerHTML, /data-public-dancer-id="new"/);
  assert.doesNotMatch(f.node("results").innerHTML, /data-public-dancer-id="(?:one|two)"/);
  assert.ok(f.requests.every(request => request.options.credentials === "omit" && request.options.cache === "no-store"));
  assert.equal(f.timers[0].delay, 60000);
  f.document.hidden = true; f.timers[0].handler(); await settle();
  assert.equal(f.requests.length, 4);
});

test("failed refresh clears stale cards and an empty roster never shows another club", async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  f.respond(() => ({ ok: false, error: "Please refresh." }));
  await f.node("venue-refresh").listeners.click();
  assert.equal(f.node("results").innerHTML, "");
  assert.equal(f.node("venue-more").hidden, true);
  assert.equal(f.node("venue-status").textContent, "Please refresh.");
  f.respond(() => ({ ok: true, venue, dancers: [], nextCursor: null }));
  await f.node("venue-refresh").listeners.click();
  assert.match(f.node("venue-status").textContent, /No participating dancers/);
  f.respond(() => ({ ok: true, venue: { ...venue, slug: "other-club" }, dancers: [dancer] }));
  await f.node("venue-refresh").listeners.click();
  assert.equal(f.node("results").innerHTML, "");
});

test("one company accent works across different state/city locations without changing public branding", async () => {
  const locations = [venue, { id: "venue-florida", slug: "company-miami", name: "Company Miami", city: "Miami" }];
  for (const location of locations) {
    const fixture = apiFixture({ venue: location, page: { dancers: [], tonightDancers: [], nextCursor: null } });
    await fixture.get("?accent=c99842&city=WrongCity");
    assert.equal(fixture.calls[0].city, location.city);
    assert.equal(fixture.calls[0].venueId, location.id);
    assert.equal(venueEmbedAccent(new URL(`https://www.mydancr.com/embed/venues/${location.slug}?accent=c99842`)), "#c99842");
  }
  for (const value of ["red", "javascript:alert(1)", "ff0000; color:red", "fff"]) assert.equal(venueEmbedAccent(new URL(`https://example.com/?accent=${encodeURIComponent(value)}`)), "#7c3aed");
  const window = runtime();
  for (const [accent, foreground] of [["#ffffff", "#050507"], ["#000000", "#ffffff"], ["#c99842", "#050507"]]) {
    const values = new Map();
    window.MydancrVenueEmbed.applyTheme({ body: { dataset: { accent }, style: { setProperty: (key, value) => values.set(key, value) } } });
    assert.equal(values.get("--embed-accent"), accent);
    assert.equal(values.get("--embed-accent-text"), foreground);
  }
  assert.doesNotMatch(read("public/venue-grid-embed.js"), /localStorage|sessionStorage|postMessage/);
  assert.doesNotMatch(read("src/live-shell/shell.html"), /venue-grid-embed\.css|venue-grid-embed\.js/);
  assert.match(read("public/dancr-brand-tokens.v1.css"), /--dancr-color-brand-primary: #7c3aed/);
});

const publicProfile = { ...dancer, city: "Las Vegas", checkedInAt: new Date().toISOString(), locationStatus: "club_confirmed",
  locationVerificationExpiresAt: new Date(Date.now() + 3600000).toISOString(), photos: [{ id: "photo", imageUrl: "https://images.example/photo.jpg" }] };
test("embedded profile endpoint rechecks public visibility, venue and current working status", async () => {
  for (const profile of [publicProfile, null, { ...publicProfile, venueId: "other" }, { ...publicProfile, checkedOutAt: new Date().toISOString() }, { ...publicProfile, locationVerificationExpiresAt: "2000-01-01" }]) {
    let contentReads = 0;
    const route = loadTs("app/api/public/venue-grid/[slug]/dancers/[dancerSlug]/route.ts", {
      "next/server": { NextResponse: Response },
      "@/src/lib/api": { apiError: () => Response.json({ ok: false }, { status: 500 }) },
      "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
      "@/src/lib/dancr/public": { getVenueProfile: async () => venue, getDancerProfile: async () => profile },
      "@/src/lib/dancr/shift-presence": { isActiveNfcPresence },
      "@/src/lib/dancr/venue-embed-media.mjs": embedMedia,
      "@/src/lib/dancr/public-dancer-content": { loadPublicDancerContent: async () => { contentReads++; return { tvVideos: [{ id: "v1", videoUrl: "https://videos.example/approved.mp4" }], secondaryUnavailable: false }; } },
    });
    const response = await route.GET(null, { params: Promise.resolve({ slug: venue.slug, dancerSlug: dancer.slug }) });
    if (profile === publicProfile) {
      assert.equal(response.status, 200);
      assert.equal(contentReads, 1);
      const body = await response.json();
      assert.equal(body.profile.videos[0].id, "v1");
      assert.equal(body.profile.locationVerificationExpiresAt, undefined);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    } else {
      assert.equal(response.status, 404);
      assert.equal(contentReads, 0);
    }
  }
});

test("normal card click opens the branded embedded profile and stale media clears on recheck", async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  const link = { closest: () => ({ dataset: { publicDancerId: dancer.id } }) };
  let prevented = false;
  f.respond(() => ({ ok: true, venue, profile: { ...publicProfile, videos: [] } }));
  f.node("results").listeners.click({ target: { closest: () => link }, preventDefault() { prevented = true; } });
  await settle();
  assert.equal(prevented, true);
  assert.equal(f.node("venue-directory").hidden, true);
  assert.equal(f.node("venue-profile").hidden, false);
  assert.match(f.node("venue-profile-content").innerHTML, /venue-embed-primary/);
  assert.match(f.node("venue-profile-content").innerHTML, /data-media-panel="photos"/);
  assert.equal(f.styles.get("--embed-accent"), "#c99842");
  assert.ok(f.requests.at(-1).url.endsWith("/echo-house/dancers/ty"));
  f.respond(() => ({ ok: false, error: "Profile unavailable." }));
  f.timers[0].handler(); await settle();
  assert.equal(f.node("venue-profile-content").innerHTML, "");
  assert.equal(f.node("venue-profile-status").textContent, "Profile unavailable.");
  f.node("venue-profile-back").listeners.click(); await settle();
  assert.equal(f.node("venue-directory").hidden, false);
  assert.equal(f.node("venue-profile").hidden, true);
});

test("embed media URLs preserve exact photo sizes and video IDs without admitting private preview links", () => {
  assert.equal(embedMedia.venueEmbedMediaUrl("https://www.mydancr.com/api/media/dancer-photo?path=owner%2Fapproved.jpg&width=320"), "/api/public/venue-embed-media/photo?path=owner%2Fapproved.jpg&width=320");
  assert.equal(embedMedia.venueEmbedMediaUrl("/api/media/dancer-video?id=public-id&poster=1"), "/api/public/venue-embed-media/video?id=public-id&poster=1");
  assert.equal(embedMedia.venueEmbedMediaUrl("/api/media/dancer-video?id=private-id&preview=capability"), null);
  assert.equal(embedMedia.venueEmbedMediaSrcSet("/api/media/dancer-photo?path=a&width=160 160w, /api/media/dancer-photo?path=a&width=320 320w"), "/api/public/venue-embed-media/photo?path=a&width=160 160w, /api/public/venue-embed-media/photo?path=a&width=320 320w");
});

test("the embed media endpoint cannot enter private preview delivery and preserves range/HEAD requests", async () => {
  const calls = [], anonymous = {}, admin = {};
  const route = loadTs("app/api/public/venue-embed-media/[kind]/route.ts", {
    "@/src/lib/dancr/media-delivery": { serveDancerMedia: async (request, kind, deps) => { calls.push({ request, kind, deps }); return new Response(null, { status: 206 }); } },
    "@/src/lib/dancr/photo-delivery-cache": { PhotoDeliveryCache: class {} },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => admin },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => anonymous },
    "@/src/lib/env": { getPublicEnv: () => ({ supabaseUrl: "https://storage.example" }) },
    "@/src/lib/server-env": { getServerEnv: () => "synthetic-server-key" },
  });
  for (const kind of ["photo", "video", "other"]) {
    assert.equal((await route.GET(new Request(`https://www.mydancr.com/api/public/venue-embed-media/${kind}?preview=private-token`), { params: Promise.resolve({ kind }) })).status, 404);
  }
  assert.equal(calls.length, 0);
  const request = new Request("https://www.mydancr.com/api/public/venue-embed-media/video?id=public-id", { method: "HEAD", headers: { range: "bytes=0-99" } });
  assert.equal((await route.HEAD(request, { params: Promise.resolve({ kind: "video" }) })).status, 206);
  assert.equal(calls[0].deps.publicClient, anonymous);
  assert.equal(calls[0].request.method, "HEAD");
  assert.equal(calls[0].request.headers.get("range"), "bytes=0-99");
});
