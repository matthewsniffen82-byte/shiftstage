// Public mobile filter/scroll journey; API writes are suppressed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/feed-render";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.route("**/api/**", async route => {
  const request = route.request();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.fulfill({ json: { ok: true } });
  const url = new URL(request.url());
  if (base.startsWith("http://localhost") && url.pathname.startsWith("/api/public/")) {
    const response = await fetch("https://www.mydancr.com" + url.pathname + url.search);
    return route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  }
  return route.continue();
});
await context.addInitScript(() => {
  localStorage.setItem("dancrAgeVerified", "true");
  window.__formatterConstructions = 0;
  Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
    construct(target, args) { window.__formatterConstructions++; return Reflect.construct(target, args); },
    apply(target, receiver, args) { window.__formatterConstructions++; return Reflect.apply(target, receiver, args); },
  });
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const errors = [], filters = [];
page.on("pageerror", error => errors.push(error.message));
let initialFormatterConstructions;
try {
  await page.goto(base + "/?city=Las%20Vegas&view=dancers", { waitUntil: "load" });
  await page.locator(".home-dancer-grid-card").first().waitFor();
  await page.waitForTimeout(1500);
  initialFormatterConstructions = await page.evaluate(() => window.__formatterConstructions);
  for (const filter of ["now", "upcoming", "all", "now", "upcoming", "all"]) {
    const result = await page.evaluate(async filter => {
      window.__formatterConstructions = 0;
      const button = document.querySelector(`[data-dancer-directory-filter="${filter}"]`);
      const expected = Number(button.querySelector(".dancer-directory-filter-count").textContent);
      const started = performance.now();
      button.click();
      const synchronousMs = performance.now() - started;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const active = document.querySelector(`[data-dancer-directory-filter="${filter}"]`);
      return { filter, expected, actual: document.querySelectorAll(".home-dancer-grid-card").length,
        selected: active.getAttribute("aria-selected"), focused: document.activeElement === active,
        formatterConstructions: window.__formatterConstructions, synchronousMs, paintOpportunityMs: performance.now() - started };
    }, filter);
    assert.equal(result.actual, result.expected);
    assert.equal(result.selected, "true");
    assert.equal(result.focused, true);
    filters.push(result);
  }
  await page.goto(base + "/?city=Las%20Vegas&view=venues", { waitUntil: "load" });
  await page.locator(".home-venue-discovery-slide").first().waitFor();
  for (const index of [0, 3, 6, 1, 0]) {
    await page.locator(".home-venue-discovery-slide").nth(index).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
  }
  assert.ok(await page.locator('.home-venue-discovery-slide[aria-current="true"]').count() <= 1);
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ base, cpuSlowdown: 4, initialFormatterConstructions, filters, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: true, initialFormatterConstructions, filters }));
