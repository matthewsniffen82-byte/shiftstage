import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/network-journey";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.route("**/api/**", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.fulfill({ json: { ok: true } }));
await context.addInitScript(() => localStorage.setItem("dancrAgeVerified", "true"));
const page = await context.newPage();
const requests = [], errors = [], pending = [], profileKeys = new Map();
let phase = "initial";
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => {
  const url = new URL(response.url());
  if (url.pathname !== "/api/public/tv") return;
  const requestPhase = phase;
  const id = url.searchParams.get("dancer") || "feed";
  if (!profileKeys.has(id)) profileKeys.set(id, profileKeys.size + 1);
  const sample = { phase: requestPhase, scope: id === "feed" ? "feed" : "profile", profileKey: profileKeys.get(id), limit: url.searchParams.get("limit"), status: response.status() };
  requests.push(sample);
  pending.push((async () => { const body = await response.body(); sample.bytes = body.length; try { const data = JSON.parse(body.toString()); sample.videos = data.videos?.length; sample.ok = data.ok; } catch { /* A redirect has no JSON. */ } })().catch(() => {}));
});
try {
  await page.goto(base + "/?city=Las%20Vegas&view=dancers", { waitUntil: "load" });
  await page.locator(".home-dancer-grid-card").first().waitFor();
  await page.waitForTimeout(2000);
  for (const filter of ["now", "upcoming", "all", "now", "all"]) {
    phase = `filter-${filter}`;
    await page.locator(`[data-dancer-directory-filter="${filter}"]`).click();
    await page.waitForTimeout(400);
  }
  phase = "open-profile";
  await page.locator(".home-dancer-grid-link").first().click();
  await page.locator("#profileBackdrop.show #profileModal").waitFor();
  await page.locator("#modalMediaTvTab").waitFor({ state: "attached" });
  await page.waitForFunction(() => document.querySelector("#modalMediaTvTab")?.getAttribute("aria-busy") !== "true");
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
} finally {
  await Promise.allSettled(pending);
  await writeFile(`${output}/results.json`, JSON.stringify({ base, requests, errors, privateDataRead: false }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ requests, errors }));
