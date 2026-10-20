import { canonicalVenueSlug } from "../src/lib/dancr/venue-branding.ts";
import * as rhino from "../src/lib/dancr/rhino-locations.ts";
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
    "@/src/lib/dancr/rhino-locations": rhino,
    "@/src/lib/dancr/public-request-rate-limit": { PublicRequestRateLimitError: RateLimit },
    "@/src/lib/dancr/public-directory": { getRankedDirectoryPage: async (_client, _request, scope) => {
      calls.push(scope); if (options.error) throw options.error;
      return options.page || { dancers: [dancer], tonightDancers: [dancer], nextCursor: null };
    } },
  });
  return { calls, get: query => route.GET(new Request(`https://www.mydancr.com/api/public/venue-grid/${location.slug}${query || ""}`), { params: Promise.resolve({ slug: location.slug }) }) };
}
function documentRoute() {
  return loadTs("app/embed/venues/[slug]/route.ts", {
    "@/src/lib/dancr/static-asset-cache.mjs": { versionStaticAssetReferences },
    "@/src/lib/dancr/venue-branding": { canonicalVenueSlug },
    "@/src/lib/dancr/rhino-locations": rhino,
    "@/src/lib/security/venue-embed-policy.mjs": { venueEmbedPolicy },
    "@/src/lib/dancr/venue-embed-theme.mjs": { venueEmbedAccent },
  });
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
  const rhinoResponse = await route.GET(new Request("https://www.mydancr.com/embed/venues/spearmint-rhino-las-vegas-demo?demo=1&location=boise"), { params: Promise.resolve({ slug: "spearmint-rhino-las-vegas-demo" }) });
  const rhinoHtml = await rhinoResponse.text();
  assert.match(rhinoHtml, /data-venue-slug="talk-of-the-town"/);
  assert.match(rhinoHtml, /value="boise"[^>]+ selected/);
  assert.match(rhinoHtml, /data-demo="true"/);
  assert.match(rhinoHtml, /<h1 aria-live="polite">Working now <span id="venue-count" hidden><\/span><\/h1>/);
  assert.match(rhinoHtml, /class="venue-embed-heading"[\s\S]*class="venue-embed-credit" href="https:\/\/www\.mydancr\.com" target="_blank" rel="noopener noreferrer"><span>mydancr\.com<\/span><\/a>[\s\S]*class="home-discovery-controls/);
  assert.doesNotMatch(rhinoHtml, /<footer/);
  assert.doesNotMatch(rhinoHtml, /Demo ·|Sample dancers|not actual|Not connected yet/);
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

test("Rhino location picker supports selection, keyboard navigation and dismissing without changing location", () => {
  let focused, changes = 0;
  const element = () => {
    const attributes = {}, listeners = {}, classes = new Set();
    const node = { hidden: true, dataset: {}, style: {}, textContent: "", innerHTML: "", tabIndex: -1,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
      setAttribute: (name, value) => { attributes[name] = value; },
      getAttribute: name => attributes[name],
      addEventListener(name, handler) { (listeners[name] ||= []).push(handler); },
      dispatchEvent(event) { (listeners[event.type] || []).forEach(handler => handler(event)); },
      focus() { focused = node; }, contains(target) { return node === target; },
    };
    return node;
  };
  const document = element(), nodes = new Map();
  document.getElementById = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const get = document.getElementById;
  const select = element();
  select.value = "las-vegas";
  select.options = [
    { value: "las-vegas", textContent: "Las Vegas, NV · 49 dancers", dataset: { count: "49" }, selected: true },
    { value: "boise", textContent: "Boise, ID · 78 dancers", dataset: { count: "78" }, selected: false },
    { value: "london", textContent: "London, UK · 51 dancers", dataset: { count: "51" }, selected: false },
  ];
  Object.defineProperty(select, "selectedOptions", { get: () => select.options.filter(option => option.value === select.value) });
  select.addEventListener("change", () => changes++);
  const options = select.options.map(option => Object.assign(element(), { dataset: { location: option.value } }));
  get("citySelectOptions").querySelectorAll = () => options;
  Object.assign(get("citySelectOptions"), { scrollHeight: 960, clientHeight: 320, scrollTop: 0 });
  get("venueLocationScrollbar").clientHeight = 320;
  const panel = get("citySelectPanel"), trigger = get("citySelectButton");
  panel.contains = target => target === panel || options.includes(target);
  const click = node => node.dispatchEvent({ type: "click" });
  const key = (node, value) => node.dispatchEvent({ type: "keydown", key: value, preventDefault() {} });
  runtime().MydancrVenueEmbed.mountLocationPicker(document, select);
  assert.equal(select.hidden, true);
  assert.equal(trigger.hidden, false);
  assert.equal(get("citySelectButtonText").textContent, "Las Vegas, NV");
  for (const option of select.options) {
    const row = get("citySelectOptions").innerHTML.match(new RegExp(`data-location="${option.value}"[^]*?</button>`))[0];
    assert.ok(row.includes(`${option.dataset.count} dancers`));
    assert.equal(row.match(/dancers/g).length, 1);
  }
  click(trigger);
  assert.equal(panel.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(focused, options[0]);
  assert.equal(get("venueLocationScrollbar").hidden, false);
  assert.equal(get("venueLocationScrollThumb").style.transform, "translateY(0px)");
  const thumbHeight = parseFloat(get("venueLocationScrollThumb").style.height);
  assert.ok(thumbHeight >= 28 && thumbHeight < 320);
  get("citySelectOptions").scrollTop = 640;
  get("citySelectOptions").dispatchEvent({ type: "scroll" });
  assert.equal(get("venueLocationScrollThumb").style.transform, `translateY(${320 - thumbHeight}px)`);
  key(options[0], "ArrowDown");
  assert.equal(focused, options[1]);
  click(options[1]);
  assert.equal(select.value, "boise");
  assert.equal(changes, 1);
  assert.equal(get("citySelectButtonText").textContent, "Boise, ID");
  assert.equal(options[1].getAttribute("aria-selected"), "true");
  assert.equal(panel.hidden, true);
  assert.equal(focused, trigger);
  key(trigger, "ArrowDown");
  key(options[1], "End");
  assert.equal(focused, options[2]);
  key(options[2], "Escape");
  assert.equal(panel.hidden, true);
  assert.equal(select.value, "boise");
  click(trigger);
  click(options[1]);
  assert.equal(changes, 1, "Reselecting a location should not reload its roster");
  click(trigger);
  document.dispatchEvent({ type: "click", target: element() });
  assert.equal(panel.hidden, true);
  click(trigger);
  document.dispatchEvent({ type: "focusin", target: element() });
  assert.equal(panel.hidden, true);
  get("citySelectOptions").scrollHeight = 320;
  click(trigger);
  assert.equal(get("venueLocationScrollbar").hidden, true);
});

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
  assert.equal(f.node("venue-count").hidden, true);
  assert.equal(f.node("venue-more").hidden, true);
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

test("Rhino showcase uses only approved public demo dancers and enforces gold", async () => {
  const rhinoVenue = { ...venue, slug: rhino.RHINO_VENUE_SLUG };
  const sample = { ...dancer, shiftSource: "demo_locked" };
  const real = { ...dancer, id: "real-checkin", shiftSource: "nfc_presence" };
  const f = apiFixture({ venue: rhinoVenue, page: { dancers: [sample, real], tonightDancers: [sample, real], nextCursor: null } });
  const preview = await (await f.get("?demo=1")).json();
  assert.deepEqual(preview.dancers.map(row => row.id), [sample.id]);
  assert.equal(preview.venue.embedAccent, "#b8860b");
  const live = await (await f.get()).json();
  assert.equal(live.dancers.length, 2);
});

test("every Rhino location has 25–80 dancers with distinct, stable roster sizes in ranked order", () => {
  assert.equal(rhino.RHINO_LOCATIONS.length, 22);
  assert.equal(new Set(rhino.RHINO_LOCATIONS.map(row => row.key)).size, 22);
  assert.equal(new Set(rhino.RHINO_LOCATIONS.map(row => row.sampleCount)).size, 22);
  const rows = Array.from({ length: 96 }, (_, i) => ({ id: `dancer-${i}` }));
  const { sampleRoster } = runtime().MydancrVenueEmbed;
  for (const location of rhino.RHINO_LOCATIONS) {
    assert.ok(Number.isInteger(location.sampleCount) && location.sampleCount >= 25 && location.sampleCount <= 80, location.label);
    const chosen = sampleRoster(rows, location.key, location.sampleCount);
    assert.equal(chosen.length, location.sampleCount);
    assert.deepEqual(Array.from(chosen), Array.from(sampleRoster(rows, location.key, location.sampleCount)));
    const indices = Array.from(chosen, row => rows.indexOf(row));
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.notDeepEqual(Array.from(sampleRoster(rows, "boise", 18)), Array.from(sampleRoster(rows, "london", 18)));
});

test("standard and old live-only Rhino links populate all 22 showcase locations", async () => {
  const route = documentRoute(), slug = rhino.RHINO_VENUE_SLUG;
  const params = { params: Promise.resolve({ slug }) };
  const rows = Array.from({ length: 96 }, (_, i) => ({ ...dancer, id: `dancer-${i}`, slug: `dancer-${i}` }));
  for (const location of rhino.RHINO_LOCATIONS) {
    let html;
    for (const oldFlag of ["", "&demo=0"]) {
      const response = await route.GET(new Request(`https://www.mydancr.com/embed/venues/${slug}?location=${location.key}${oldFlag}`), params);
      assert.equal(response.status, 307);
      const destination = new URL(response.headers.get("location"));
      assert.equal(destination.searchParams.get("location"), location.key);
      assert.equal(destination.searchParams.get("demo"), "1");
      html = await (await route.GET(new Request(destination), params)).text();
      assert.match(html, /data-demo="true"/);
      assert.equal([...html.matchAll(/<option /g)].length, 22);
      assert.match(html, new RegExp(`value="${location.key}"[^>]+ selected`));
      assert.ok(html.includes(`>${location.label} · ${location.sampleCount} dancers</option>`));
    }
    const f = componentFixture();
    f.document.body.dataset.demo = html.match(/data-demo="([^"]+)"/)[1];
    f.document.body.dataset.venueSlug = slug;
    f.node("venue-location").selectedOptions = [{ value: location.key, textContent: location.label,
      dataset: { count: String(location.sampleCount), venue: location.venueSlug || "" } }];
    f.respond(() => ({ ok: true, venue: { ...venue, slug }, dancers: rows, nextCursor: null }));
    await f.window.MydancrVenueEmbed.mount(f.document);
    assert.equal(f.node("venue-count").textContent, String(location.sampleCount), location.label);
    assert.equal([...f.node("results").innerHTML.matchAll(/data-public-dancer-id=/g)].length, location.sampleCount);
    assert.equal(f.node("venue-status").hidden, true);
    assert.match(f.requests[0].url, /\?demo=1$/);
  }
});

test("dashboard preview, copied link and iframe all open the full Rhino presentation", async () => {
  const copied = [];
  const jsx = (type, props) => ({ type, props });
  const component = loadTs("app/dashboard/VenueWebsiteGrid.tsx", {
    "react": { useState: () => ["", () => {}] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/src/lib/dancr/venue-branding": { canonicalVenueSlug },
    "@/src/lib/dancr/rhino-locations": rhino,
  }, { navigator: { clipboard: { writeText: async value => { copied.push(value); } } } }).default;
  const flatten = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
  const nodes = flatten(component({ slug: "spearmint-rhino-las-vegas-demo" }));
  const links = nodes.filter(node => node.type === "a");
  const url = `https://www.mydancr.com/embed/venues/${rhino.RHINO_VENUE_SLUG}?demo=1`;
  assert.deepEqual(links.map(node => node.props.href), [url]);
  nodes.filter(node => node.type === "button").forEach(node => node.props.onClick());
  await settle();
  assert.equal(copied[0], url);
  assert.ok(copied[1].includes(`src="${url}"`));
  assert.equal(copied.length, 2);
});

test("location changes clear old cards and stale requests cannot replace the selected roster", async () => {
  const f = componentFixture();
  f.document.body.dataset.demo = "true";
  f.window.location.href = "https://www.mydancr.com/embed/venues/echo-house?demo=1";
  f.window.history = { replaceState() {} };
  const select = f.node("venue-location");
  select.selectedOptions = [{ value: "las-vegas", textContent: "Las Vegas, NV", dataset: { count: "96" } }];
  let finishOld;
  f.respond(() => new Promise(resolve => { finishOld = resolve; }));
  const initial = f.window.MydancrVenueEmbed.mount(f.document);
  select.value = "boise";
  select.selectedOptions = [{ value: "boise", textContent: "Boise, ID", dataset: { count: "18" } }];
  const rows = Array.from({ length: 30 }, (_, i) => ({ ...dancer, id: `dancer-${i}`, slug: `dancer-${i}` }));
  f.respond(() => ({ ok: true, venue, dancers: rows, nextCursor: null }));
  await select.listeners.change();
  assert.equal(f.node("venue-count").textContent, "18");
  assert.match(f.node("results").innerHTML, /location=boise&amp;demo=1/);
  assert.equal(f.node("venue-name").textContent, "Spearmint Rhino");
  finishOld({ ok: true, venue, dancers: [dancer], nextCursor: null });
  await initial;
  assert.equal(f.node("venue-count").textContent, "18");
  assert.equal(f.node("venue-name").textContent, "Spearmint Rhino");
});

test("live location selector never borrows dancers for an unconnected location", async () => {
  const f = componentFixture();
  f.node("venue-location").selectedOptions = [{ value: "boise", textContent: "Boise, ID · Not connected yet", dataset: { venue: "" } }];
  await f.window.MydancrVenueEmbed.mount(f.document);
  assert.equal(f.requests.length, 0);
  assert.equal(f.node("results").innerHTML, "");
  assert.match(f.node("venue-status").textContent, /not connected/);
});

test("embedded profile uses the full shared component, preserves media and returns to its location", async () => {
  const rhinoVenue = { ...venue, slug: rhino.RHINO_VENUE_SLUG, name: "Spearmint Rhino", address: "3340 S Highland Dr", state: "NV" };
  const source = { ...publicProfile, shiftSource: "demo_locked", upcomingShifts: [{ venueSlug: rhinoVenue.slug, venueName: "Spearmint Rhino" }] };
  let profile = source;
  let contentReads = 0;
  const component = "FullSharedEmbeddedProfile";
  const route = loadTs("app/embed/venues/[slug]/dancers/[dancerSlug]/page.tsx", {
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/public": { getVenueProfile: async () => rhinoVenue, getDancerProfile: async () => profile },
    "@/src/lib/dancr/shift-presence": { isActiveNfcPresence },
    "@/src/lib/dancr/venue-branding": { canonicalVenueSlug },
    "@/src/lib/dancr/rhino-locations": rhino,
    "@/src/lib/dancr/venue-guest-colors": { getVenueGuestColors: async () => ({ embedAccent: "#ff0000" }) },
    "@/src/lib/dancr/venue-embed-media.mjs": embedMedia,
    "@/src/lib/dancr/public-dancer-content": { loadPublicDancerContent: async () => { contentReads++; return { tvVideos: [{ id: "v1", videoUrl: "/api/media/dancer-video?id=v1" }], secondaryUnavailable: false }; } },
    "./EmbeddedDancerProfile": { default: component, __esModule: true },
    "@/public/profile-media-owner-controls.css": {}, "@/public/profile-media-card-feed.css": {},
    "@/public/profile-actions-compact.css": {}, "@/public/dancer-profile-layout.css": {}, "./embedded-profile.css": {},
  });
  const render = query => route.default({ params: Promise.resolve({ slug: rhinoVenue.slug, dancerSlug: "ty" }), searchParams: Promise.resolve(query) });
  const result = await render({ demo: "1", location: "boise" });
  assert.equal(result.type, component);
  assert.equal(result.props.profile.city, "Boise");
  assert.equal(result.props.profile.upcomingShifts[0].venueName, "Spearmint Rhino · Boise, ID");
  assert.equal(result.props.profile.photos.length, source.photos.length);
  assert.equal(result.props.tvVideos[0].videoUrl, "/api/public/venue-embed-media/video?id=v1");
  assert.equal(result.props.returnHref, "/embed/venues/talk-of-the-town?location=boise&demo=1");
  assert.equal(result.props.accent, "#b8860b");
  const boiseDirections = new URL(result.props.venueDirectionsHref);
  assert.equal(boiseDirections.origin + boiseDirections.pathname, "https://www.google.com/maps/dir/");
  assert.equal(boiseDirections.searchParams.get("api"), "1");
  assert.equal(boiseDirections.searchParams.get("destination"), "Spearmint Rhino, Boise, ID");
  const vegas = await render({ location: "las-vegas" });
  assert.equal(new URL(vegas.props.venueDirectionsHref).searchParams.get("destination"), "Spearmint Rhino, 3340 S Highland Dr, Las Vegas, NV");
  assert.equal(source.city, "Las Vegas");
  for (const demo of [undefined, "0"]) {
    const legacy = await render({ demo, location: "boise" });
    assert.equal(legacy.props.preview, true);
    assert.equal(legacy.props.profile.city, "Boise");
    assert.equal(legacy.props.returnHref, "/embed/venues/talk-of-the-town?location=boise&demo=1");
  }
  profile = { ...source, shiftSource: "nfc_presence" };
  await assert.rejects(render({ demo: "1" }), /NOT_FOUND/);
  await assert.rejects(render({ demo: "0" }), /NOT_FOUND/);
  profile = { ...source, venueId: "another-club" };
  await assert.rejects(render({}), /NOT_FOUND/);
  profile = { ...source, checkedOutAt: new Date().toISOString() };
  await assert.rejects(render({}), /NOT_FOUND/);
  assert.equal(contentReads, 4);
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
