// Read-only browser inventory of actual CSS/font usage and stable UI styles.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/rendering";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const [index, route] of ["/", "/?city=Las%20Vegas&view=venues", "/?auth=login"].entries()) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.route("**/api/**", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.fulfill({ json: { ok: true } }));
    await context.addInitScript(() => localStorage.setItem("dancrAgeVerified", "true"));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + route, { waitUntil: "load" });
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const selectors = ["body", "header", "#accountBtn", "#customerDealQuickBtn", "#customerNotificationQuickBtn", '[data-dancer-directory-filter="all"]', ".home-dancer-grid-card", ".home-venue-discovery-slide", "nav.home-bottom-nav", "#authPage"];
      const properties = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color", "backgroundColor", "backgroundImage", "borderRadius", "borderColor", "boxShadow", "filter", "backdropFilter", "display", "position", "padding", "gap", "minHeight"];
      return { styles: Object.fromEntries(selectors.map(selector => {
        const element = document.querySelector(selector); if (!element) return [selector, null];
        const style = getComputedStyle(element); return [selector, Object.fromEntries(properties.map(property => [property, style[property]]))];
      })), fonts: [...document.fonts].map(font => ({ family: font.family, weight: font.weight, status: font.status, display: font.display })),
      fontResources: performance.getEntriesByType("resource").filter(entry => /fonts\.(googleapis|gstatic)\.com/.test(entry.name)).map(entry => ({ path: new URL(entry.name).pathname, bytes: entry.transferSize, duration: entry.duration })),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      stylesheetOrder: [...document.styleSheets].map(sheet => ({ path: sheet.href ? new URL(sheet.href).pathname : "inline", rules: (() => { try { return sheet.cssRules.length; } catch { return null; } })() })) };
    });
    await page.screenshot({ path: `${output}/${index}.png` });
    results.push({ route, ...result, errors });
    assert.equal(result.horizontalOverflow, false);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); }
console.log(JSON.stringify(results.map(result => ({ route: result.route, loadedFonts: [...new Set(result.fonts.filter(font => font.status === "loaded").map(font => font.family))], fontRequests: result.fontResources.length, stylesheets: result.stylesheetOrder, errors: result.errors }))));
