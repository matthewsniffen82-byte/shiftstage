// Read-only held/failing public-response fixtures; production data and account writes are untouched.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/loading-feedback";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const reports = [];
try {
  for (const scenario of ["delayed-response", "failed-response-retry"]) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    let mode = scenario === "delayed-response" ? "held" : "error", release, held = false;
    const gate = new Promise(resolve => { release = resolve; });
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.fulfill({ json: { ok: true } });
      if (url.pathname === "/api/public/tv" && !url.searchParams.has("dancer")) {
        if (mode === "error") return route.fulfill({ status: 503, json: { ok: false, error: "Fixture read temporarily unavailable" } });
        if (mode === "held") { held = true; await gate; }
      }
      await route.continue().catch(() => {});
    });
    await context.addInitScript(() => localStorage.setItem("dancrAgeVerified", "true"));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const report = { scenario, states: [], errors };
    try {
      await page.goto(base + "/?city=Las%20Vegas&view=dancers", { waitUntil: "load" });
      await page.locator(".home-dancer-grid-card").first().waitFor();
      await page.locator("#homeBottomTv").tap();
      if (scenario === "delayed-response") {
        await page.locator(".home-tv-feed-loading").waitFor({ state: "visible" });
        await page.waitForTimeout(600);
        assert.equal(held, true);
        assert.equal(await page.locator("#results").getAttribute("aria-busy"), "true");
        assert.equal(await page.locator(".home-tv-feed-video").count(), 0);
        report.states.push({ state: "loading", responseStillHeld: held, realVideos: 0, placeholderVisible: true, busy: true });
      } else {
        await page.getByRole("button", { name: "Retry MyDancr TV" }).waitFor();
        assert.equal(await page.locator(".home-tv-feed-loading").count(), 0);
        assert.notEqual(await page.locator("#results").getAttribute("aria-busy"), "true");
        report.states.push({ state: "error", retryAvailable: true, staleLoading: false });
      }
      mode = "real"; release();
      if (scenario === "failed-response-retry") await page.getByRole("button", { name: "Retry MyDancr TV" }).tap();
      await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(video => !video.paused && video.currentTime > .1), null, { timeout: 45000 });
      assert.equal(await page.locator(".home-tv-feed-loading").count(), 0);
      assert.notEqual(await page.locator("#results").getAttribute("aria-busy"), "true");
      report.states.push({ state: "ready", realVideoPlaying: true, staleLoading: false });
      assert.deepEqual(errors, []);
    } finally {
      release(); reports.push(report);
      await mkdir(output, { recursive: true });
      await writeFile(`${output}/results.json`, JSON.stringify({ base, productionUiChanged: false, controlledReadFixtures: true, reports }, null, 2));
      await context.close();
    }
  }
} finally { await browser.close(); }
console.log(JSON.stringify(reports));
