// Hold one public feed request to simulate a slow connection, then leave and return.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/video-request-cancel";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
let release, markHeld, heldCount = 0;
const held = new Promise(resolve => { markHeld = resolve; });
await context.route("**/api/**", async route => {
  if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.fulfill({ json: { ok: true } });
  const url = new URL(route.request().url());
  if (url.pathname === "/api/public/tv" && !url.searchParams.has("dancer") && heldCount++ === 0) {
    markHeld();
    await new Promise(resolve => { release = resolve; });
  }
  await route.continue().catch(() => {}); // The deliberately canceled request may already be gone.
});
await context.addInitScript(() => {
  localStorage.setItem("dancrAgeVerified", "true");
  window.__feedRequests = [];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    if (url.pathname === "/api/public/tv" && !url.searchParams.has("dancer")) {
      const record = { aborted: options?.signal?.aborted === true };
      window.__feedRequests.push(record);
      options?.signal?.addEventListener("abort", () => { record.aborted = true; }, { once: true });
    }
    return nativeFetch(input, options);
  };
});
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(base + "/?city=Las%20Vegas&view=dancers", { waitUntil: "load" });
  await page.locator(".home-dancer-grid-card").first().waitFor();
  await page.locator("#homeBottomTv").click();
  let timer;
  try { await Promise.race([held, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("TV request was not intercepted")), 10000); })]); }
  finally { clearTimeout(timer); }
  await page.locator('[data-tab="dancers"]').first().click();
  await page.waitForFunction(() => window.__feedRequests[0]?.aborted);
  release();
  await page.locator("#homeBottomTv").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(video => !video.paused && video.currentTime > .1), null, { timeout: 30000 });
  assert.deepEqual(errors, []);
} finally {
  release?.();
  const requests = await page.evaluate(() => window.__feedRequests).catch(() => []);
  await writeFile(`${output}/results.json`, JSON.stringify({ base, simulatedStalledRequest: true, requests, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: true, simulatedStalledRequest: true }));
