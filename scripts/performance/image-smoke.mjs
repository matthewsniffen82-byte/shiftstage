// Tests real browser responsive selection; API data is synthetic and no writes occur.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "http://localhost:3087";
const output = process.env.PERF_OUTPUT || ".qa/image-smoke";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const [width, dpr, expected] of [[393, 2, 800], [390, 3, 1280], [1440, 2, 1280]]) {
    const context = await browser.newContext({ viewport: { width, height: 852 }, deviceScaleFactor: dpr, isMobile: width < 500, serviceWorkers: "block" });
    await context.route("**/api/**", route => route.fulfill({ json: { ok: true, cities: [], venues: [], dancers: [], videos: [], count: 0 } }));
    await context.addInitScript(() => localStorage.setItem("dancrAgeVerified", "true"));
    const page = await context.newPage();
    const requests = [], errors = [], cache = [];
    page.on("request", request => { if (new URL(request.url()).pathname.includes("/dancr-hero")) requests.push(new URL(request.url()).pathname); });
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (new URL(response.url()).pathname.includes("/dancr-hero")) cache.push(response.headers()["cache-control"]); });
    await page.goto(base, { waitUntil: "load" });
    await page.locator("img.hero-art").evaluate(image => image.decode());
    const hero = await page.locator("img.hero-art").evaluate(image => ({ src: new URL(image.currentSrc).pathname, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height }));
    assert.match(hero.src, new RegExp(`dancr-hero-${expected}-`));
    assert.equal(requests.length, 1, "responsive preload must not fetch the fallback as well");
    assert.ok(cache.every(value => value?.includes("immutable")));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/hero-${width}-${dpr}x.png` });
    results.push({ width, dpr, hero, requests, cache, errors });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ base, syntheticApiData: true, results }, null, 2));
}
console.log(JSON.stringify(results));
