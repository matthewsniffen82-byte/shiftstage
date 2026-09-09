import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { isWebkitNavigationCancellation } from "./browser-diagnostics.mjs";
const { chromium, webkit, devices } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/mobile-matrix";
const enforce = process.env.PERF_EXPECT_OPTIMIZED === "1";
const catalog = await fetch(base + "/api/public/tv?city=Las%20Vegas&limit=50").then(r => r.json());
const slug = catalog.videos?.find(v => v.distributionScope === "profile_and_feed" && v.dancer?.slug)?.dancer.slug;
assert.ok(slug);
const cases = [
  { name: "android-wifi", engine: "chromium", device: "Pixel 5", cpu: 1, latency: 20, mbps: 20 },
  { name: "android-cellular", engine: "chromium", device: "Pixel 5", cpu: 4, latency: 100, mbps: 4 },
  { name: "android-slow", engine: "chromium", device: "Pixel 5", cpu: 6, latency: 180, mbps: 1.6 },
  { name: "iphone-size-cellular", engine: "chromium", device: "iPhone 13", cpu: 4, latency: 100, mbps: 4 },
  { name: "webkit-iphone", engine: "webkit", device: "iPhone 13" },
  { name: "webkit-iphone-landscape", engine: "webkit", device: "iPhone 13 landscape" },
];
const rows = [];
await mkdir(output, { recursive: true });
for (const config of cases.filter(config => !process.env.PERF_MATRIX_CASES || process.env.PERF_MATRIX_CASES.split(",").includes(config.name))) {
  const browser = await (config.engine === "webkit" ? webkit : chromium).launch({ ...(config.engine === "chromium" ? { channel: "msedge" } : {}), headless: true });
  const context = await browser.newContext({ ...devices[config.device], serviceWorkers: "block" });
  // Preserve native reads/caching while keeping every browser fixture read-only.
  await context.addInitScript(() => {
    localStorage.setItem("dancrAgeVerified", "true");
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, options = {}) => ["GET", "HEAD", "OPTIONS"].includes(String(options.method || input?.method || "GET").toUpperCase())
      ? nativeFetch(input, options)
      : Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }));
    navigator.sendBeacon = () => true;
    const nativeOpen = XMLHttpRequest.prototype.open, nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, ...args) { this.__publicReadOnly = ["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase()); return nativeOpen.call(this, method, ...args); };
    XMLHttpRequest.prototype.send = function(...args) { if (!this.__publicReadOnly) { this.abort(); return; } return nativeSend.apply(this, args); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  if (config.engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: config.latency, downloadThroughput: config.mbps * 1e6 / 8, uploadThroughput: 1e6 / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: config.cpu });
  }
  const row = { config, phases: [], errors: [], consoleErrors: [], runtimeErrors: [], failedRequests: [], errorDetails: [] };
  await context.exposeBinding("__recordRuntimeError", (_source, error) => row.runtimeErrors.push(error));
  await context.addInitScript(() => {
    window.addEventListener("error", event => { void window.__recordRuntimeError({ type: "error", message: event.message }).catch(() => {}); });
    window.addEventListener("unhandledrejection", event => { void window.__recordRuntimeError({ type: "unhandledrejection", message: String(event.reason) }).catch(() => {}); });
  });
  page.on("pageerror", e => row.consoleErrors.push(e.message));
  page.on("pageerror", e => row.errorDetails.push({ message: e.message, stack: e.stack, lastCompletedPhase: row.phases.at(-1) }));
  page.on("requestfailed", request => row.failedRequests.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText, lastCompletedPhase: row.phases.at(-1) }));
  try {
    await page.goto(`${base}/dancers/${encodeURIComponent(slug)}?media=video&mediaIndex=0`, { waitUntil: "load", timeout: 90000 });
    await page.locator(".profile-media-viewer-close").waitFor();
    row.closeControl = await page.locator(".profile-media-viewer-close").evaluate(button => {
      const box = button.getBoundingClientRect(), banner = document.querySelector(".mydancr-preview-banner")?.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { top: box.top, bottom: box.bottom, bannerBottom: banner?.bottom, hit: hit?.className, receivesPointer: button === hit || button.contains(hit) };
    });
    await page.waitForFunction(() => [...document.querySelectorAll(".profile-media-viewer video")].some(v => !v.paused && v.currentTime > .1), null, { timeout: 45000 });
    row.phases.push("profile-video-playing");
    const closeStarted = performance.now();
    if (row.closeControl.receivesPointer) await page.locator(".profile-media-viewer-close").tap();
    else { if (enforce) throw new Error("Profile close is covered"); await page.keyboard.press("Escape"); }
    await page.locator(".profile-media-viewer").waitFor({ state: "detached" });
    row.touchCloseMs = row.closeControl.receivesPointer ? performance.now() - closeStarted : null;
    row.phases.push("profile-closed");
    await page.goto(base + "/?city=Las%20Vegas&view=dancers", { waitUntil: "load", timeout: 90000 });
    await page.locator(".home-dancer-grid-card").first().waitFor();
    for (const filter of ["now", "upcoming", "all"]) await page.locator(`[data-dancer-directory-filter="${filter}"]`).tap();
    row.phases.push("discovery-touch-filters");
    await page.goto(base + "/venues/deja-vu-showgirls", { waitUntil: "load", timeout: 90000 });
    row.phases.push("venue-route");
    await page.goBack({ waitUntil: "load" });
    await page.locator(".home-dancer-grid-card").first().waitFor();
    row.phases.push("back-navigation");
    await page.goto(base + "/?auth=login", { waitUntil: "load", timeout: 90000 });
    await page.locator('#authForm input[type="email"]').fill("performance@example.invalid");
    await page.locator('#customerPassword').fill("Local-fixture-only-123!");
    await page.locator("#authCreateTab").tap();
    await page.locator("#customerSignupBtn").tap();
    await page.locator("#authForm").waitFor({ state: "visible" });
    row.phases.push("login-and-signup-forms-without-submit");
    await page.locator("#authClose").tap();
    await page.locator(await page.locator("#homeBottomTv").isVisible() ? "#homeBottomTv" : "#homeTvLaunch").tap();
    await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(v => !v.paused && v.currentTime > .1), null, { timeout: 45000 });
    for (const index of [1, 3, 2, 0]) {
      await page.locator(".home-tv-feed-slide").nth(index).evaluate(slide => slide.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.waitForTimeout(350);
    }
    row.media = await page.locator(".home-tv-feed-video").evaluateAll(videos => ({ playing: videos.filter(v => !v.paused).length, sources: videos.filter(v => v.hasAttribute("src")).length, posters: videos.filter(v => v.hasAttribute("poster")).length }));
    assert.ok(row.media.playing <= 1 && row.media.sources <= 3 && row.media.posters <= 3);
    row.phases.push("rapid-video-scroll-bounded-resources");
    await page.locator('[data-tab="dancers"]').first().tap();
    assert.equal(await page.locator(".home-tv-feed-video[src]").count(), 0);
    row.phases.push("left-video");
    // The desktop WebKit port reports canceled old-document fetches as page errors.
    // Retain each diagnostic and accept only a matching canceled request/phase;
    // actual window errors, unhandled rejections and other diagnostics still fail.
    row.cancelledNavigationDiagnostics = row.errorDetails.filter(error => isWebkitNavigationCancellation(error, row.failedRequests, config.engine));
    assert.deepEqual(row.runtimeErrors, []);
    assert.deepEqual(row.errorDetails.filter(error => !row.cancelledNavigationDiagnostics.includes(error)), []);
  } catch (error) { row.errors.push(error.message); }
  finally {
    await page.screenshot({ path: `${output}/${config.name}.png`, timeout: 15000 }).catch(() => {});
    rows.push(row);
    await writeFile(`${output}/results.json`, JSON.stringify({ base, enforce, note: "Simulated devices; Chromium network/CPU throttling. WebKit desktop port with iPhone viewport/UA is unthrottled, not physical Safari hardware. API writes suppressed; forms filled but not submitted.", rows }, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify({ name: config.name, closeControl: row.closeControl, phases: row.phases, errors: row.errors }));
}
if (enforce) assert.ok(rows.every(row => !row.errors.length && row.closeControl?.receivesPointer), "Every mobile journey must pass; inspect the recorded failing phase.");
