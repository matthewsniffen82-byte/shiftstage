// Read-only cellular journey. Source assignments measure the active clip's real
// buffer; Chromium's media transfer counters include read-ahead and are not used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extractLiveShellAppScript } from "../../src/lib/dancr/live-shell-script.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".next-video-warmup";
const localShell = process.env.PERF_LOCAL_SHELL === "1";
const enforce = process.env.PERF_EXPECT_OPTIMIZED === "1";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (let run = 1; run <= Number(process.env.PERF_RUNS || 2); run++) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.route("**/api/**", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.fulfill({ json: { ok: true } }));
    if (localShell) {
      const script = extractLiveShellAppScript(await readFile("outputs/index.html", "utf8"));
      await context.route("**/live-shell.js?*", route => route.fulfill({ contentType: "application/javascript", body: script }));
    }
    await context.addInitScript(() => {
      localStorage.setItem("dancrAgeVerified", "true");
      window.__warmupEvents = [];
      const capture = (video, type) => {
        if (!video.matches?.(".home-tv-feed-video")) return;
        const videos = [...document.querySelectorAll(".home-tv-feed-video")];
        const active = document.querySelector('.home-tv-feed-slide[aria-current="true"] video');
        let ahead = 0;
        if (active) for (let i = 0; i < active.buffered.length; i++) {
          if (active.buffered.start(i) <= active.currentTime && active.buffered.end(i) >= active.currentTime) ahead = active.buffered.end(i) - active.currentTime;
        }
        window.__warmupEvents.push({ type, index: videos.indexOf(video), at: performance.now(), activeIndex: videos.indexOf(active), ahead, remaining: active ? active.duration - active.currentTime : null });
      };
      const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      Object.defineProperty(HTMLMediaElement.prototype, "src", { ...source, set(value) { capture(this, "source"); source.set.call(this, value); } });
      for (const type of ["loadstart", "loadeddata", "playing", "waiting"]) document.addEventListener(type, event => capture(event.target, type), true);
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 500000, uploadThroughput: 125000 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(base + "/tv", { waitUntil: "load" });
    await page.waitForTimeout(9000);
    const events = await page.evaluate(() => window.__warmupEvents);
    results.push({ run, errors, events });
    assert.ok(events.some(event => event.type === "playing" && event.index === 0), "the first clip plays");
    assert.deepEqual(errors, []);
    if (enforce) for (const event of events.filter(event => event.type === "source" && event.index >= 0 && event.index !== event.activeIndex)) {
      assert.ok(event.ahead >= Math.min(3, event.remaining) - .05, "neighbor downloads wait for spare active buffer");
    }
    await context.close();
  }
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/results.json`, JSON.stringify({ base, localShell, enforce, results }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: true, localShell, results }));
