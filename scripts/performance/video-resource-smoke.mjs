// Read-only playback journey. Visibility events are simulated to test app cleanup,
// not to claim measurements of physical mobile background behavior.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/video-resource";
const enforce = process.env.PERF_EXPECT_OPTIMIZED === "1";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.route("**/api/**", async route => {
  if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.fulfill({ json: { ok: true } });
  const url = new URL(route.request().url());
  if (new URL(base).hostname === "localhost") {
    if (!url.pathname.startsWith("/api/public/")) return route.fulfill({ json: { ok: false } });
    return route.fulfill({ response: await route.fetch({ url: "https://www.mydancr.com" + url.pathname + url.search }) });
  }
  return route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem("dancrAgeVerified", "true");
  window.__videoEvents = [];
  for (const type of ["loadstart", "playing", "waiting", "stalled", "error"]) document.addEventListener(type, event => {
    if (event.target instanceof HTMLVideoElement) window.__videoEvents.push({ type, time: performance.now(), index: [...document.querySelectorAll(".home-tv-feed-video")].indexOf(event.target) });
  }, true);
});
const page = await context.newPage();
const states = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
async function capture(label) {
  const state = await page.evaluate(label => ({ label, videos: [...document.querySelectorAll(".home-tv-feed-video")].map((video, index) => {
    const rect = video.getBoundingClientRect();
    return { index, paused: video.paused, active: video.closest(".home-tv-feed-slide")?.getAttribute("aria-current") === "true", viewportInactive: video.closest(".home-tv-feed-slide")?.dataset.viewportInactive, viewportPaused: video.closest(".home-tv-feed-slide")?.dataset.viewportPaused, top: rect.top, bottom: rect.bottom, source: video.hasAttribute("src"), preload: video.preload, poster: video.hasAttribute("poster"), ready: video.readyState, time: video.currentTime, visible: rect.bottom > 72 && rect.top < innerHeight - 88, buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]) };
  }) }), label);
  states.push(state);
  assert.ok(state.videos.filter(video => !video.paused).length <= 1, "only one feed video plays");
  if (enforce) {
    assert.ok(state.videos.filter(video => video.source).length <= 3, "bounded active/next/previous sources");
    assert.ok(state.videos.filter(video => video.poster).length <= 3, "bounded adjacent posters");
    assert.ok(state.videos.every(video => video.paused || video.visible), "offscreen clips stay paused");
  }
  return state;
}
try {
  await page.goto(base + "/tv", { waitUntil: "load" });
  await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(video => !video.paused && video.currentTime > .1), null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  await capture("first-playing");
  for (const index of [1, 2, 5, 2, 1, 0]) {
    await page.locator(".home-tv-feed-slide").nth(index).evaluate(slide => slide.scrollIntoView({ block: "start", behavior: "instant" }));
    await page.waitForTimeout(250);
    // IntersectionObserver runs after layout; sample after two real paint
    // opportunities rather than forcing geometry ahead of its queued callback.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await capture(`rapid-${index}`);
  }
  await page.waitForTimeout(1500);
  await capture("settled");
  await page.evaluate(() => { window.__testVisibility = "hidden"; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__testVisibility }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(350);
  const hidden = await capture("simulated-hidden");
  if (enforce) assert.ok(hidden.videos.every(video => video.paused), "hidden page pauses playback");
  await page.evaluate(() => { window.__testVisibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(1000);
  const resumed = await capture("visible-again");
  if (enforce) assert.equal(resumed.videos.filter(video => !video.paused).length, 1, "active clip resumes");
  await page.locator('[data-tab="dancers"]').first().click();
  await page.waitForTimeout(350);
  const left = await capture("left-tv");
  assert.equal(left.videos.filter(video => video.source || !video.paused).length, 0, "leaving TV releases feed videos");
  assert.deepEqual(errors, []);
} finally {
  const events = await page.evaluate(() => window.__videoEvents).catch(() => []);
  await writeFile(`${output}/results.json`, JSON.stringify({ base, enforce, simulatedVisibility: true, states, events, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify(states.map(state => ({ label: state.label, sources: state.videos.filter(video => video.source).length, playing: state.videos.filter(video => !video.paused).length, posters: state.videos.filter(video => video.poster).length }))));
