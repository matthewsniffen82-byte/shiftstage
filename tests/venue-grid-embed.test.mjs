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
function loadTs(path, dependencies, globals = {}) {
  dependencies = { "@/src/lib/dancr/club-media-permissions": {restrictClubProfile: async (_client,profile) => profile}, ...dependencies };
  const exports = {};
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(js, { ...globals, exports, Request, Response, URL, URLSearchParams, require(name) {
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
function documentRoute(colors = { embedAccent: null }) {
  return loadTs("app/embed/venues/[slug]/route.ts", {
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/public": { getVenueProfile: async (_client, slug) => slug === venue.slug ? venue : null },
    "@/src/lib/dancr/static-asset-cache.mjs": { versionStaticAssetReferences },
    "@/src/lib/dancr/venue-branding": { canonicalVenueSlug },
    "@/src/lib/security/venue-embed-policy.mjs": { venueEmbedPolicy },
    "@/src/lib/dancr/venue-embed-theme.mjs": { venueEmbedAccent },
    "@/src/lib/dancr/venue-guest-colors": { getVenueGuestColors: async (_client, venueId) => { assert.equal(venueId, venue.id); return colors; } },
  });
}

test("the embed document starts with the saved club accent and ignores URL colors", async () => {
  for (const [saved, expected] of [["#C99842", "#c99842"], [null, "#6d28ff"], ['\"><script>', "#6d28ff"]]) {
    const route = documentRoute({ embedAccent: saved, internalAccent: "#ff0000" });
    const response = await route.GET(new Request(`https://www.mydancr.com/embed/venues/${venue.slug}?accent=00ffff`), { params: Promise.resolve({ slug: venue.slug }) });
    const html = await response.text();
    assert.ok(html.includes(`data-accent="${expected}"`));
    assert.ok(html.includes(`data-venue-guest-color="${expected === "#6d28ff" ? "default" : "custom"}"`));
    assert.doesNotMatch(html, /#ff0000|#00ffff/);
  }
});

test("embed API locks venue, city and Working Now even when query filters are tampered with", async () => {
  const other = { ...dancer, id: "other", venueId: "another-club" };
  const offline = { ...dancer, id: "offline" };
  const fixture = apiFixture({ page: { dancers: [{ ...dancer, shiftEndsAt: "private deadline", socialLinks: ["private"] }, other, offline], tonightDancers: [dancer, other], nextCursor: "next" } });
  const response = await fixture.get("?city=Miami&venue=another-club&filter=all&scope=all");
  assert.equal(JSON.stringify(fixture.calls), JSON.stringify([{ city: "Las Vegas", venueId: venue.id, filter: "now", cursor: "" }]));
  const body = await response.json();
  assert.equal(body.venue.city, venue.city, 'the displayed city belongs to the club, not the URL filter');
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
  assert.equal((await reset.json()).venue.embedAccent, "#6d28ff");
  assert.equal((await (await apiFixture().get()).json()).venue.embedAccent, null);
});

test("only the exact embed document path is exempt from DENY and gets public-only CSP", async () => {
  const matcher = pathToRegexp(nonEmbedDocumentSource);
  for (const path of ["/", "/dashboard", "/dancers/ty", "/api/public/venue-grid/echo-house", "/embed/venues/echo-house/settings", "/embed/venues/"]) assert.ok(matcher.test(path), path);
  assert.equal(matcher.test("/embed/venues/echo-house"), false);
  assert.equal(matcher.test("/embed/venues/echo-house/"), false);
  assert.equal(matcher.test("/embed/venues/echo-house/dancers/ty"), false);
  assert.ok(matcher.test("/embed/venues/echo-house/dancers/ty/settings"));
  const rules = await nextConfig.headers();
  assert.equal(rules.find(rule => rule.source === "/:path*").headers.some(header => header.key === "X-Frame-Options"), false);
  assert.equal(rules.find(rule => rule.source === nonEmbedDocumentSource).headers[0].value, "DENY");
  const profileHeaders = rules.find(rule => rule.source === "/embed/venues/:slug/dancers/:dancerSlug").headers;
  assert.match(profileHeaders.find(header => header.key === "Content-Security-Policy").value, /frame-ancestors 'self' https:/);
  assert.equal(profileHeaders.find(header => header.key === "Cache-Control").value, "private, no-store");
  const route = documentRoute();
  const response = await route.GET(new Request("https://www.mydancr.com/embed/venues/echo-house"), { params: Promise.resolve({ slug: venue.slug }) });
  assert.equal(response.headers.get("content-security-policy"), venueEmbedPolicy);
  assert.match(venueEmbedPolicy, /frame-ancestors 'self' https:/);
  assert.doesNotMatch(venueEmbedPolicy, /unsafe-inline/);
  const html = await response.text();
  assert.match(html, /data-venue-slug="echo-house"/);
  assert.match(html, /home-dancer-grid home-dancer-three-column/);
  assert.match(html, /dancer-grid-card\.js/);
  assert.doesNotMatch(html, /live-shell\.js|<form|localStorage/);
  for (const slug of ['a" onload="alert(1)', "../dashboard"]) assert.equal((await route.GET(null, { params: Promise.resolve({ slug }) })).status, 404);
});

function runtime() {
  const window = { location: { origin: "https://www.mydancr.com" }, crypto: { randomUUID } };
  const context = vm.createContext({ window, URL, URLSearchParams, AbortSignal, Event });
  vm.runInContext(read("public/dancer-grid-card.js"), context);
  vm.runInContext(read("public/venue-grid-embed.js"), context);
  return window;
}

test("only dashboard previews show the fixed club dashboard return link", async () => {
  const route = documentRoute();
  for (const [query, expected] of [["", false], ["?from=club-dashboard", true], ["?from=https://example.com", false]]) {
    const response = await route.GET(new Request(`https://www.mydancr.com/embed/venues/echo-house${query}`), { params: Promise.resolve({ slug: venue.slug }) });
    const html = await response.text();
    assert.equal(html.includes('href="/dashboard/venue"'), expected);
    assert.equal(html.includes("Back to club dashboard"), expected);
    assert.ok(html.includes(`data-from-club-dashboard="${expected}"`));
  }

});

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
  // DOM reconciliation is exercised separately; this fixture checks network,
  // pagination, status and location transitions without a browser journey.
  window.MydancrDancerGrid = { ...window.MydancrDancerGrid, update(container, markup) { container.innerHTML = markup; } };
  // The embed captures the shared renderer at script evaluation.
  vm.runInNewContext(read("public/venue-grid-embed.js"), { window, URL, URLSearchParams, AbortSignal, Event });
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", innerHTML: "", hidden: false, listeners: {},
      focus() {}, close() {}, showModal() {},
      addEventListener(event, handler) { this.listeners[event] = handler; }, setAttribute() {}, removeAttribute(key) { delete this[key]; }, querySelectorAll() { return []; } });
    return nodes.get(id);
  };
  const styles = new Map();
  const document = { hidden: false, body: { dataset: { venueSlug: venue.slug, accent: "#c99842" }, style: { setProperty: (key, value) => styles.set(key, value) } }, getElementById: node, listeners: {},
    addEventListener(event, handler) { this.listeners[event] = handler; } };
  let responder = () => ({ ok: true, venue, dancers: [dancer], nextCursor: "page-two" });
  window.fetch = async (url, options) => { requests.push({ url, options }); const response = await responder(url, options); return response instanceof Response ? response : Response.json(response); };
  window.scrollTo = () => {};
  window.setInterval = (handler, delay) => { timers.push({ handler, delay }); };
  return { window, document, node, requests, timers, styles, respond: fn => { responder = fn; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("dashboard origin follows profile links without changing public embed links", async () => {
  for (const from of ["true", "false", undefined]) {
    const f = componentFixture();
    f.document.body.dataset.fromClubDashboard = from;
    await f.window.MydancrVenueEmbed.mount(f.document);
    assert.equal(f.node("results").innerHTML.includes("from=club-dashboard"), from === "true");
  }
});

test("an existing embed applies saved club colors on load and refresh without replacing its link", async () => {
  const f = componentFixture();
  f.respond(() => ({ ok: true, venue: { ...venue, embedAccent: "#00aaff" }, dancers: [dancer], nextCursor: null }));
  await f.window.MydancrVenueEmbed.mount(f.document);
  assert.equal(f.styles.get("--embed-accent"), "#00aaff");
  f.respond(() => ({ ok: true, venue: { ...venue, embedAccent: "#6d28ff" }, dancers: [dancer], nextCursor: null }));
  f.timers[0].handler(); await settle();
  assert.equal(f.styles.get("--embed-accent"), "#6d28ff");
  assert.ok(f.requests.every(request => request.url.includes(`/venue-grid/${venue.slug}`)));
});

test("empty rosters retain club branding and refresh updated or removed logos safely", async () => {
  const f = componentFixture();
  const brand = { ...venue, logoImageUrl: "https://images.example/club-logo.webp", embedAccent: "#b8860b" };
  f.respond(() => ({ ok: true, venue: brand, dancers: [], nextCursor: null }));
  await f.window.MydancrVenueEmbed.mount(f.document);
  assert.equal(f.node("venue-logo").src, brand.logoImageUrl);
  assert.equal(f.node("venue-logo").alt, "Echo House logo");
  assert.equal(f.node("venue-logo").hidden, false);
  assert.equal(f.node("venue-city").textContent, venue.city);
  assert.equal(f.node("venue-city").hidden, false);
  assert.equal(f.node("venue-count").textContent, "0");
  assert.equal(f.styles.get("--embed-accent"), brand.embedAccent);
  f.node("venue-logo").listeners.error();
  assert.equal(f.node("venue-logo").hidden, true);
  brand.logoImageUrl = "https://images.example/replacement.webp";
  await f.node("venue-refresh").listeners.click();
  assert.equal(f.node("venue-logo").hidden, false);
  assert.equal(f.node("venue-logo").src, brand.logoImageUrl);
  for (const value of ["javascript:alert(1)", ""]) {
    brand.logoImageUrl = value;
    await f.node("venue-refresh").listeners.click();
    assert.equal(f.node("venue-logo").hidden, true);
    assert.equal(f.node("venue-logo").src, undefined);
  }
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

test("failed refresh keeps the loaded grid, while a confirmed empty roster removes old cards", async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  const markup = f.node("results").innerHTML;
  const count = f.node("venue-count").textContent;
  f.respond(() => ({ ok: false, error: "Please refresh." }));
  await f.node("venue-refresh").listeners.click();
  assert.equal(f.node("results").innerHTML, markup);
  assert.equal(f.node("venue-count").textContent, count);
  assert.equal(f.node("venue-more").hidden, false);
  assert.equal(f.node("venue-status").textContent, "Please refresh.");
  f.respond(() => ({ ok: true, venue, dancers: [], nextCursor: null }));
  await f.node("venue-refresh").listeners.click();
  assert.match(f.node("venue-status").textContent, /No participating dancers/);
  assert.equal(f.node("venue-count").textContent, "0");
  assert.equal(f.node("venue-count").hidden, false);
  f.respond(() => ({ ok: true, venue: { ...venue, slug: "other-club" }, dancers: [dancer] }));
  await f.node("venue-refresh").listeners.click();
  assert.equal(f.node("results").innerHTML, "");
});

test("automatic refresh keeps every loaded page during slow and partially failed requests", async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  f.respond(() => ({ ok: true, venue, dancers: [{ ...dancer, id: "two" }], nextCursor: null }));
  await f.node("venue-more").listeners.click();
  const markup = f.node("results").innerHTML;
  const deferred = Promise.withResolvers();
  f.respond(url => url.includes("cursor=") ? deferred.promise : { ok: true, venue, dancers: [{ ...dancer, id: "new" }], nextCursor: "page-two" });
  f.timers[0].handler();
  await settle();
  assert.equal(f.node("results").innerHTML, markup);
  deferred.reject(new Error("Connection lost"));
  await settle();
  assert.equal(f.node("results").innerHTML, markup);
  assert.equal(f.node("venue-count").textContent, "2");
  f.respond(() => ({ ok: true, venue, dancers: [dancer], nextCursor: null }));
  f.timers[0].handler(); await settle();
  assert.match(f.node("results").innerHTML, /data-public-dancer-id="one"/);
  assert.doesNotMatch(f.node("results").innerHTML, /data-public-dancer-id="two"/);
});

test("pagination remains usable with its original visit after a failed background refresh", async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  const visit = f.requests[0].options.headers["x-discovery-visit"];
  f.respond(() => { throw new Error("offline"); });
  f.timers[0].handler(); await settle();
  f.respond(() => ({ ok: true, venue, dancers: [{ ...dancer, id: "two" }], nextCursor: null }));
  await f.node("venue-more").listeners.click();
  assert.match(f.requests.at(-1).url, /cursor=page-two/);
  assert.equal(f.requests.at(-1).options.headers["x-discovery-visit"], visit);
  assert.match(f.node("results").innerHTML, /data-public-dancer-id="one"/);
  assert.match(f.node("results").innerHTML, /data-public-dancer-id="two"/);
});

for (const status of [401, 403, 404, 410]) test(`confirmed club/access removal (${status}) clears the embedded grid`, async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  f.respond(() => Response.json({ ok: false, error: "Unavailable" }, { status }));
  f.timers[0].handler(); await settle();
  assert.equal(f.node("results").innerHTML, "");
  assert.equal(f.node("venue-count").hidden, true);
});

test("venue scope ignores URL color overrides and saved colors use readable button text", async () => {
  const locations = [venue, { id: "venue-florida", slug: "company-miami", name: "Company Miami", city: "Miami" }];
  for (const location of locations) {
    const fixture = apiFixture({ venue: location, page: { dancers: [], tonightDancers: [], nextCursor: null } });
    await fixture.get("?accent=c99842&city=WrongCity");
    assert.equal(fixture.calls[0].city, location.city);
    assert.equal(fixture.calls[0].venueId, location.id);
    assert.equal(venueEmbedAccent(new URL(`https://www.mydancr.com/embed/venues/${location.slug}?accent=c99842`)), "#6d28ff");
  }
  for (const value of ["red", "javascript:alert(1)", "ff0000; color:red", "fff"]) assert.equal(venueEmbedAccent(new URL(`https://example.com/?accent=${encodeURIComponent(value)}`)), "#6d28ff");
  const window = runtime();
  for (const [accent, text] of [["#ffffff", "#050507"], ["#000000", "#ffffff"], ["#c99842", "#050507"], ["red", "#ffffff"]]) {
    const values = new Map();
    const dataset = { accent, venueGuestColor: "custom" };
    window.MydancrVenueEmbed.applyTheme({ body: { dataset, style: { setProperty: (key, value) => values.set(key, value) } } });
    assert.equal(values.get("--embed-accent"), accent === "red" ? "#6d28ff" : accent);
    assert.equal(values.get("--embed-accent-text"), text);
    assert.equal(dataset.venueGuestColor, accent === "red" ? "default" : "custom");
  }
  assert.doesNotMatch(read("public/venue-grid-embed.js"), /localStorage|sessionStorage|postMessage/);
  assert.doesNotMatch(read("src/live-shell/shell.html"), /venue-grid-embed\.css|venue-grid-embed\.js/);
  assert.match(read("public/dancr-brand-tokens.v1.css"), /--dancr-color-brand-primary: #6d28ff/);
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
      const presence = await route.GET(new Request(`https://www.mydancr.com/api/public/venue-grid/${venue.slug}/dancers/${dancer.slug}?presence=1`), { params: Promise.resolve({ slug: venue.slug, dancerSlug: dancer.slug }) });
      assert.deepEqual(await presence.json(), { ok: true });
      assert.equal(contentReads, 1, "Presence checks must not reload profile media");
    } else {
      assert.equal(response.status, 404);
      assert.equal(contentReads, 0);
    }
  }
});

test("cards navigate directly to the full embedded profile in the same frame", async () => {
  const f = componentFixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  assert.match(f.node("results").innerHTML, /href="\/embed\/venues\/echo-house\/dancers\/ty"/);
  assert.doesNotMatch(f.node("results").innerHTML, /target="_blank"/);
  assert.equal(f.node("venue-count").textContent, "1+");
  assert.equal(f.node("venue-count").hidden, false);
  const invalid = f.window.MydancrDancerGrid.render({ href: "/embed/venues/echo-house/settings", name: "Ty" });
  assert.match(invalid, /href="#"/);
});

test("dashboard preview, copied link and iframe use the real club", async () => {
  const copied = [];
  const jsx = (type, props) => ({ type, props });
  const component = loadTs("app/dashboard/VenueWebsiteGrid.tsx", {
    "react": { useState: () => ["", () => {}] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/src/lib/dancr/venue-branding": { canonicalVenueSlug },
  }, { navigator: { clipboard: { writeText: async value => { copied.push(value); } } } }).default;
  const flatten = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
  const nodes = flatten(component({ slug: venue.slug }));
  const links = nodes.filter(node => node.type === "a");
  const url = `https://www.mydancr.com/embed/venues/${venue.slug}`;
  assert.deepEqual(links.map(node => node.props.href), [`${url}?from=club-dashboard`]);
  nodes.filter(node => node.type === "button").forEach(node => node.props.onClick());
  await settle();
  assert.equal(copied[0], url);
  assert.ok(copied[1].includes(`src="${url}"`));
  assert.equal(copied.length, 2);
});

test("embedded profile uses the full shared component, preserves media and returns to its actual club", async () => {
  const profileVenue = { ...venue, name: "Echo House", address: "100 Example St", state: "NV" };
  const source = { ...publicProfile, venueName: "Echo House", shiftSource: "nfc_presence", upcomingShifts: [{ venueSlug: profileVenue.slug, venueName: "Echo House" }] };
  let profile = source;
  let contentReads = 0;
  const component = "FullSharedEmbeddedProfile";
  const route = loadTs("app/embed/venues/[slug]/dancers/[dancerSlug]/page.tsx", {
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/public": { getVenueProfile: async () => profileVenue, getDancerProfile: async () => profile },
    "@/src/lib/dancr/shift-presence": { isActiveNfcPresence },
    "@/src/lib/dancr/venue-branding": { canonicalVenueSlug },
    "@/src/lib/dancr/venue-guest-colors": { getVenueGuestColors: async () => ({ embedAccent: "#ff0000" }) },
    "@/src/lib/dancr/venue-embed-media.mjs": embedMedia,
    "@/src/lib/dancr/public-dancer-content": { loadPublicDancerContent: async () => { contentReads++; return { tvVideos: [{ id: "v1", videoUrl: "/api/media/dancer-video?id=v1" }], secondaryUnavailable: false }; } },
    "./EmbeddedDancerProfile": { default: component, __esModule: true },
    "@/public/profile-media-owner-controls.css": {}, "@/public/profile-media-card-feed.css": {},
    "@/public/profile-actions-compact.css": {}, "@/public/dancer-profile-layout.css": {}, "@/public/dancer-profile-details.css": {}, "./embedded-profile.css": {},
  });
  const render = query => route.default({ params: Promise.resolve({ slug: profileVenue.slug, dancerSlug: "ty" }), searchParams: Promise.resolve(query) });
  const result = await render({ demo: "1", location: "boise" });
  assert.equal(result.type, component);
  assert.equal(result.props.profile.city, "Las Vegas");
  assert.equal(result.props.profile.venueName, "Echo House");
  assert.equal(result.props.profile.upcomingShifts[0].venueName, "Echo House");
  assert.equal(result.props.profile.photos.length, source.photos.length);
  assert.equal(result.props.tvVideos[0].videoUrl, "/api/public/venue-embed-media/video?id=v1");
  assert.equal(result.props.returnHref, "/embed/venues/echo-house");
  const dashboardPreview = await render({ demo: "1", location: "boise", from: "club-dashboard" });
  assert.equal(dashboardPreview.props.returnHref, "/embed/venues/echo-house?from=club-dashboard");
  assert.equal(result.props.accent, "#ff0000");
  const boiseDirections = new URL(result.props.venueDirectionsHref);
  assert.equal(boiseDirections.origin + boiseDirections.pathname, "https://www.google.com/maps/dir/");
  assert.equal(boiseDirections.searchParams.get("api"), "1");
  assert.equal(boiseDirections.searchParams.get("destination"), "Echo House, 100 Example St, Las Vegas, NV");
  const vegas = await render({ location: "las-vegas" });
  assert.equal(new URL(vegas.props.venueDirectionsHref).searchParams.get("destination"), "Echo House, 100 Example St, Las Vegas, NV");
  assert.equal(source.city, "Las Vegas");
  profile = { ...source, venueId: "another-club" };
  await assert.rejects(render({}), /NOT_FOUND/);
  profile = { ...source, checkedOutAt: new Date().toISOString() };
  await assert.rejects(render({}), /NOT_FOUND/);
  assert.equal(contentReads, 3);
  const client = read("app/embed/venues/[slug]/dancers/[dancerSlug]/EmbeddedDancerProfile.tsx");
  assert.match(client, /<PublicDancerProfile \{\.\.\.props\}/);
  assert.match(client, /\?presence=1/);
  assert.doesNotMatch(client, /location\.reload|router\.refresh/);
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


test("deleted clubs and retired demo links return 404 without branding or sample rosters", async () => {
  for (const slug of ["spearmint-rhino", "spearmint-rhino-las-vegas-demo", "talk-of-the-town", "missing-club"]) {
    assert.equal(canonicalVenueSlug(slug), slug);
    const response = await documentRoute().GET(new Request(`https://www.mydancr.com/embed/venues/${slug}?demo=1&location=boise`), { params: Promise.resolve({ slug }) });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Club not found.");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("a deleted club loses its loaded name, logo and roster on refresh", async () => {
  const f = componentFixture();
  f.respond(() => ({ ok: true, venue: { ...venue, logoImageUrl: "https://images.example/logo.webp" }, dancers: [dancer], nextCursor: null }));
  await f.window.MydancrVenueEmbed.mount(f.document);
  assert.equal(f.node("venue-name").textContent, venue.name);
  assert.equal(f.node("venue-city").textContent, venue.city);
  f.respond(() => Response.json({ ok: false, error: "This club is unavailable." }, { status: 404 }));
  await f.node("venue-refresh").listeners.click();
  assert.equal(f.node("venue-name").textContent, "");
  assert.equal(f.node("venue-city").textContent, "");
  assert.equal(f.node("venue-city").hidden, true);
  assert.equal(f.node("venue-logo").hidden, true);
  assert.equal(f.node("venue-logo").src, undefined);
  assert.equal(f.node("results").innerHTML, "");
  assert.equal(f.node("venue-count").hidden, true);
});
