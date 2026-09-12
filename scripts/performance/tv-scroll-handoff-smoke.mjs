// Public mobile scroll journey; suppress API writes and measure playback overlap.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extractLiveShellAppScript } from "../../src/lib/dancr/live-shell-script.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/tv-scroll-handoff";
const localShell = process.env.PERF_LOCAL_SHELL === "1";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
});
await context.route("**/api/**", (route) => (
  ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
    ? route.continue()
    : route.fulfill({ json: { ok: true } })
));
if (localShell) {
  const script = extractLiveShellAppScript(await readFile(new URL("../../outputs/index.html", import.meta.url), "utf8"));
  await context.route("**/live-shell.js?*", (route) => route.fulfill({ contentType: "application/javascript", body: script }));
}
await context.addInitScript(() => {
  localStorage.setItem("dancrAgeVerified", "true");
  window.__tvPlaybackStarts = [];
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.matches(".home-tv-feed-video")) {
      const videos = [...document.querySelectorAll(".home-tv-feed-video")];
      window.__tvPlaybackStarts.push({
        index: videos.indexOf(this),
        otherPlaying: videos.filter((video) => video !== this && !video.paused).length,
      });
    }
    return nativePlay.call(this);
  };
});
const page = await context.newPage();
const errors = [], selections = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${base}/tv`, { waitUntil: "load" });
  for (const index of [0, 1, 2, 1, 2, 1, 0]) {
    await page.locator(".home-tv-feed-slide").nth(index).evaluate((slide) => {
      slide.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    await page.waitForFunction((index) => {
      const slide = document.querySelectorAll(".home-tv-feed-slide")[index];
      const video = slide?.querySelector("video");
      return slide?.getAttribute("aria-current") === "true" && video && !video.paused && video.currentTime > .1;
    }, index, { timeout: 30000 });
    const state = await page.evaluate((index) => {
      const videos = [...document.querySelectorAll(".home-tv-feed-video")];
      return { index, playing: videos.filter((video) => !video.paused).length,
        sources: videos.filter((video) => video.hasAttribute("src")).length };
    }, index);
    assert.equal(state.playing, 1);
    assert.ok(state.sources <= 3);
    selections.push(state);
  }
  const starts = await page.evaluate(() => window.__tvPlaybackStarts);
  assert.ok(starts.length >= selections.length, "the journey exercises each playback handoff");
  assert.deepEqual(starts.filter((start) => start.otherPlaying > 0), [], "pause outgoing playback before starting another decoder");
  assert.deepEqual(errors, []);
} finally {
  const starts = await page.evaluate(() => window.__tvPlaybackStarts).catch(() => []);
  await writeFile(`${output}/results.json`, JSON.stringify({ base, localShell, selections, starts, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: true, localShell, selections }));
