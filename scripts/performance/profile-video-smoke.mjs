// Production public-profile regression journey. All API writes are suppressed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/profile-video";
await mkdir(output, { recursive: true });
const catalog = await fetch(base + "/api/public/tv?city=Las%20Vegas&limit=3").then(response => response.json());
const slug = catalog.videos?.[0]?.dancer?.slug;
assert.ok(slug);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.route("**/api/**", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.fulfill({ json: { ok: true } }));
await context.addInitScript(() => localStorage.setItem("dancrAgeVerified", "true"));
const page = await context.newPage();
const errors = [], states = [];
page.on("pageerror", error => errors.push(error.message));
const capture = async label => {
  const videos = await page.locator(".profile-media-viewer video").evaluateAll(videos => videos.map(video => ({ paused: video.paused, source: video.hasAttribute("src"), preload: video.preload, time: video.currentTime })));
  states.push({ label, videos });
  return videos;
};
const visibility = async state => {
  await page.evaluate(state => {
    window.__testVisibility = state;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__testVisibility });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await page.waitForTimeout(300);
};
try {
  await page.goto(`${base}/dancers/${encodeURIComponent(slug)}?media=video&mediaIndex=0`, { waitUntil: "load" });
  await page.waitForFunction(() => [...document.querySelectorAll(".profile-media-viewer video")].some(video => !video.paused && video.currentTime > .1), null, { timeout: 30000 });
  assert.equal((await capture("playing")).filter(video => !video.paused).length, 1);
  await page.evaluate(() => { window.__originalPlayer = document.querySelector(".profile-media-viewer video"); });
  await visibility("hidden");
  assert.ok((await capture("hidden")).every(video => video.paused));
  await visibility("visible");
  await page.waitForFunction(() => !document.querySelector(".profile-media-viewer video")?.paused);
  assert.equal(await page.evaluate(() => window.__originalPlayer === document.querySelector(".profile-media-viewer video")), true);
  await capture("resumed-same-player");
  await page.locator(".profile-media-viewer video").first().click();
  await page.waitForFunction(() => document.querySelector(".profile-media-viewer video")?.paused);
  await visibility("hidden");
  await visibility("visible");
  assert.ok((await capture("manual-pause-preserved")).every(video => video.paused));
  await page.locator(".profile-media-viewer-close").click();
  await page.locator(".profile-media-viewer").waitFor({ state: "detached" });
  assert.equal((await capture("closed")).length, 0);
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ base, slug, simulatedVisibility: true, states, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ slug, passed: true, phases: states.map(state => state.label) }));
