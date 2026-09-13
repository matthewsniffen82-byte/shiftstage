// Read-only real-browser check of the generated classic-script boundary.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { liveShellRoute } from "../../tests/helpers/live-shell-route.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/shell-features";
const local = process.env.PERF_LOCAL_SHELL === "1";
const html = local ? await (await liveShellRoute().route.GET()).text() : "";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => localStorage.setItem("dancrAgeVerified", "true"));
await context.route("**/*", async route => {
  if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.fulfill({ json: { ok: true } });
  const url = new URL(route.request().url());
  if (local && route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: html });
  if (local && url.pathname === "/live-shell.js") return route.fulfill({ contentType: "text/javascript", body: await readFile("outputs/live-shell-app.js") });
  if (local && url.pathname === "/live-shell-feature.js") return route.fulfill({ contentType: "text/javascript", body: await readFile("outputs/live-shell-tv.js") });
  return route.continue();
});
const page = await context.newPage();
const errors = [], features = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (/\/(?:live-shell-feature|hls-engine)\.js/.test(request.url())) features.push(request.url()); });
try {
  for (const path of ["/?city=Las%20Vegas", "/?city=Las%20Vegas&view=working", "/?city=Las%20Vegas&view=venues"]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    assert.equal(features.length, 0, "Public discovery does not fetch TV constructors or the HLS engine");
    checks.push({ path, featureRequests: 0 });
  }
  await page.locator("#homeBottomTv").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(video => !video.paused && video.currentTime > .1));
  assert.equal(features.filter(url => url.includes("live-shell-feature.js")).length, 1);
  await page.locator('[data-tab="dancers"]').first().click();
  await page.locator("#homeBottomTv").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(video => !video.paused && video.currentTime > .1));
  assert.equal(features.filter(url => url.includes("live-shell-feature.js")).length, 1, "Returning to TV reuses its loaded code");
  checks.push({ path: "TV, leave, return", tvChunkRequests: 1 });
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ base, local, checks, features, errors }, null, 2));
  await context.unrouteAll({ behavior: "wait" });
  await browser.close();
}
console.log(JSON.stringify({ checks, errors }));
