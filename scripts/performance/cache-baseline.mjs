// Browser HTTP cache must stay enabled: no Playwright request routing is used.
// Suppress writes at fetch/beacon/XHR entry points in this disposable public session.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/cache-baseline";
await mkdir(output, { recursive: true });
const html = await fetch(base).then(response => response.text());
const assetPaths = ["/dancr-aesthetic.v1.css", "/mydancr-api-transport.js", "/profile-photo-crop.js"];
const references = [...html.matchAll(/(?:src|href)="([^"<>]+)"/g)].map(match => match[1]);
const headers = [];
for (const asset of assetPaths) for (const reference of [asset, references.find(url => url.split("?")[0] === asset), `${asset}?v=obsolete-version`].filter(Boolean)) {
  const response = await fetch(base + reference, { method: "HEAD" });
  headers.push({ reference, status: response.status, cacheControl: response.headers.get("cache-control"), etag: response.headers.get("etag") });
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("dancrAgeVerified", "true");
  window.__suppressedWrites = 0;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const method = String(options.method || input?.method || "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) { window.__suppressedWrites++; return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } })); }
    return nativeFetch(input, options);
  };
  navigator.sendBeacon = () => { window.__suppressedWrites++; return true; };
  const nativeOpen = XMLHttpRequest.prototype.open, nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, ...args) { this.__publicReadOnly = ["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase()); return nativeOpen.call(this, method, ...args); };
  XMLHttpRequest.prototype.send = function(...args) { if (!this.__publicReadOnly) { window.__suppressedWrites++; this.abort(); return; } return nativeSend.apply(this, args); };
});
const samples = [];
try {
  for (const route of ["/", "/dancers/layout-review-09"]) for (const visit of ["cold", "warm"]) {
    const page = await context.newPage(), requests = new Map(), errors = [];
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    cdp.on("Network.requestWillBeSent", ({ requestId, request, type }) => { const url = new URL(request.url); requests.set(requestId, { path: url.pathname, type, method: request.method, cached: false, bytes: 0 }); });
    cdp.on("Network.requestServedFromCache", ({ requestId }) => { if (requests.has(requestId)) requests.get(requestId).cached = true; });
    cdp.on("Network.responseReceived", ({ requestId, response }) => { if (requests.has(requestId)) Object.assign(requests.get(requestId), { status: response.status, cached: requests.get(requestId).cached || response.fromDiskCache === true }); });
    cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => { if (requests.has(requestId)) requests.get(requestId).bytes = encodedDataLength; });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + route, { waitUntil: "load" });
    await page.waitForTimeout(3500);
    const all = [...requests.values()];
    samples.push({ route, visit, bytes: all.reduce((sum, request) => sum + request.bytes, 0), cachedRequests: all.filter(request => request.cached).length,
      networkRequests: all.filter(request => !request.cached).length, runtimeScripts: all.filter(request => assetPaths.includes(request.path)),
      unexpectedWrites: all.filter(request => !["GET", "HEAD", "OPTIONS"].includes(request.method)), suppressedWrites: await page.evaluate(() => window.__suppressedWrites), errors });
    await page.close();
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ base, cacheEnabled: true, routingDisabled: true, headers, samples }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ headers, samples }));
