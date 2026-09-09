// Repeated public feed transitions. Weak references avoid retaining the nodes under test.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/memory-journey";
const enforce = process.env.PERF_EXPECT_OPTIMIZED === "1";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.route("**/api/**", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.fulfill({ json: { ok: true } }));
await context.addInitScript(() => {
  localStorage.setItem("dancrAgeVerified", "true");
  window.__videoRefs = [];
  const create = document.createElement.bind(document);
  document.createElement = function (...args) {
    const element = create(...args);
    if (element instanceof HTMLVideoElement) window.__videoRefs.push(new WeakRef(element));
    return element;
  };
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const samples = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
async function sample(label) {
  await cdp.send("HeapProfiler.collectGarbage");
  const videos = await page.evaluate(() => window.__videoRefs.map(ref => ref.deref()).filter(Boolean).map(video => ({ connected: video.isConnected, source: video.hasAttribute("src"), playing: !video.paused, readyState: video.readyState })));
  const heap = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  const row = { label, videos: videos.length, sourced: videos.filter(v => v.source).length, detachedSourced: videos.filter(v => !v.connected && v.source).length, detachedPlaying: videos.filter(v => !v.connected && v.playing).length, playing: videos.filter(v => v.playing).length, heapBytes: heap.usedSize, ...dom };
  samples.push(row);
  if (enforce) {
    assert.equal(row.detachedSourced, 0, label + ": removed videos release sources");
    assert.equal(row.detachedPlaying, 0, label + ": removed videos stop");
    assert.ok(row.playing <= 1);
  }
}
try {
  await page.goto(base + "/tv?city=Las%20Vegas", { waitUntil: "load" });
  await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(v => !v.paused && v.currentTime > .1));
  await sample("initial");
  for (let cycle = 1; cycle <= 6; cycle++) {
    await page.locator("#citySelect").selectOption("Miami", { force: true });
    await page.waitForTimeout(1000);
    await sample(`empty-city-${cycle}`);
    await page.locator("#citySelect").selectOption("Las Vegas", { force: true });
    await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(v => !v.paused && v.currentTime > .1));
    for (const index of [2, 4, 1]) {
      await page.locator(".home-tv-feed-slide").nth(index).evaluate(slide => slide.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.waitForTimeout(180);
    }
    await page.locator('[data-tab="dancers"]').first().click();
    await page.waitForTimeout(1200);
    await sample(`left-tv-${cycle}`);
    await page.locator('#homeBottomTv').click();
    await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(v => !v.paused && v.currentTime > .1));
  }
  await sample("final-tv");
  assert.deepEqual(errors, []);
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/results.json`, JSON.stringify({ base, enforce, note: "Chromium lab, six public city/scroll/navigation cycles; forced GC and weak video references. Bounded resources are evidence; short heap changes do not prove a leak or its absence.", samples, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify(samples));
