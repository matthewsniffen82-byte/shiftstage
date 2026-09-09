// Read-only mobile lab audit. Uses an existing Playwright installation; adds no app dependency.
// PERF_PLAYWRIGHT_MODULE may point to an installed playwright package directory.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/performance";
const routes = JSON.parse(process.env.PERF_ROUTES || '["/","/?auth=login","/tv","/dashboard/customer"]');
const runs = Number(process.env.PERF_RUNS || 3);
const customerFixture = process.env.PERF_CUSTOMER_FIXTURE === "1";
const fixtureAccount = { id: "performance-lab-customer", role: "customer", displayName: "Performance lab", email: "performance@example.invalid", accountState: "active" };
const profiles = {
  wifi: { width: 390, height: 844, cpu: 1, latency: 20, download: 20_000_000 / 8, upload: 5_000_000 / 8 },
  cellular: { width: 393, height: 852, cpu: 4, latency: 100, download: 4_000_000 / 8, upload: 1_000_000 / 8 },
  slow: { width: 360, height: 800, cpu: 6, latency: 180, download: 1_600_000 / 8, upload: 750_000 / 8 },
};
const selectedProfiles = (process.env.PERF_PROFILES || "cellular").split(",");
const safeUrl = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return ""; } };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PERF_BROWSER || "msedge", headless: true });
const results = [];
try {
  for (const profileName of selectedProfiles) for (const route of routes) for (let run = 1; run <= runs; run++) {
    const profile = profiles[profileName];
    if (!profile) throw new Error(`Unknown profile: ${profileName}`);
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    let suppressedWrites = 0;
    await context.route("**/api/**", request => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.request().method())) {
        suppressedWrites++;
        return request.fulfill({ status: 200, json: { ok: true } });
      }
      if (customerFixture && !new URL(request.request().url()).pathname.startsWith("/api/public/")) {
        return request.fulfill({ json: { ok: true, account: fixtureAccount, profile: {}, saved: { follows: [], venueFollows: [], dealSaves: [], goingSignals: [], favorites: [], dealRedemptions: [] }, notifications: [], threads: [], access: null } });
      }
      return request.continue();
    });
    await context.addInitScript(({ customerFixture, fixtureAccount }) => {
      localStorage.setItem("dancrAgeVerified", "true");
      if (customerFixture) localStorage.setItem("dancrAuthSessionV1", JSON.stringify({ account: fixtureAccount, accessToken: "performance-lab-access", refreshToken: "performance-lab-refresh", expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
      const report = { lcp: null, cls: 0, interactionMax: null, longTasks: [], frames: [], videos: [] };
      window.__perfLab = report;
      let clsStart = 0, clsLast = 0, clsWindow = 0;
      const observe = (type, fn, extra = {}) => {
        try { new PerformanceObserver(list => list.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch { /* unsupported browser metric */ }
      };
      observe("largest-contentful-paint", e => { report.lcp = { ms: e.startTime, tag: e.element?.tagName, id: e.element?.id, url: e.url ? new URL(e.url).pathname : null }; });
      observe("layout-shift", e => {
        if (e.hadRecentInput) return;
        if (e.startTime - clsLast > 1000 || e.startTime - clsStart > 5000) { clsWindow = 0; clsStart = e.startTime; }
        clsLast = e.startTime; clsWindow += e.value; report.cls = Math.max(report.cls, clsWindow);
      });
      observe("event", e => { if (e.interactionId) report.interactionMax = Math.max(report.interactionMax || 0, e.duration); }, { durationThreshold: 16 });
      observe("longtask", e => report.longTasks.push({ start: e.startTime, duration: e.duration }));
      const seen = new WeakMap();
      for (const event of ["loadstart", "playing", "waiting", "stalled", "pause", "error"]) document.addEventListener(event, e => {
        if (!(e.target instanceof HTMLVideoElement)) return;
        let item = seen.get(e.target);
        if (!item) { item = { firstLoad: null, firstPlay: null, waiting: 0, stalled: 0, errors: 0 }; seen.set(e.target, item); report.videos.push(item); }
        if (event === "loadstart" && item.firstLoad === null) item.firstLoad = performance.now();
        if (event === "playing" && item.firstPlay === null) item.firstPlay = performance.now();
        if (event === "waiting") item.waiting++;
        if (event === "stalled") item.stalled++;
        if (event === "error") item.errors++;
      }, true);
    }, { customerFixture, fixtureAccount });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: profile.latency, downloadThroughput: profile.download, uploadThroughput: profile.upload });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
    await cdp.send("Performance.enable");
    const requests = new Map(), errors = [];
    cdp.on("Network.requestWillBeSent", e => requests.set(e.requestId, { url: safeUrl(e.request.url), type: e.type, start: e.timestamp, bytes: 0 }));
    cdp.on("Network.responseReceived", e => {
      const item = requests.get(e.requestId);
      if (item) Object.assign(item, { status: e.response.status, ttfbMs: e.response.timing?.receiveHeadersEnd ?? null, cache: e.response.fromDiskCache, mime: e.response.mimeType, cacheControl: e.response.headers["cache-control"] || e.response.headers["Cache-Control"] || null, serverTiming: e.response.headers["server-timing"] || null, shellVersion: e.response.headers["x-dancr-live-shell-version"] || null });
    });
    cdp.on("Network.dataReceived", e => { const item = requests.get(e.requestId); if (item) item.bytes += e.encodedDataLength; });
    cdp.on("Network.loadingFinished", e => { const item = requests.get(e.requestId); if (item) Object.assign(item, { bytes: e.encodedDataLength, durationMs: (e.timestamp - item.start) * 1000 }); });
    cdp.on("Network.loadingFailed", e => { const item = requests.get(e.requestId); if (item) item.failure = e.errorText; });
    page.on("pageerror", error => errors.push(error.message));
    let navigationError = null;
    const journeyStarted = performance.now();
    try { await page.goto(base + route, { waitUntil: "load", timeout: 90000 }); } catch (error) { navigationError = error.message.split("\n")[0]; }
    await page.waitForTimeout(6000);
    const initialRequests = [...requests.values()].map(item => ({ ...item }));
    const initial = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = performance.getEntriesByType("paint");
      const images = [...document.images].map(img => {
        const rect = img.getBoundingClientRect();
        const url = img.currentSrc ? new URL(img.currentSrc) : null;
        return { path: url?.pathname || "", transformedWidth: url?.searchParams.get("width") || null,
          naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
          displayedWidth: Math.round(rect.width), displayedHeight: Math.round(rect.height),
          top: Math.round(rect.top), aboveFold: rect.bottom > 0 && rect.top < innerHeight && rect.width > 0,
          loading: img.loading, fetchPriority: img.fetchPriority, complete: img.complete };
      });
      const backgroundImages = [...document.querySelectorAll('[style*="--custom-photo"]')].map(el => {
        const rect = el.getBoundingClientRect();
        return { className: el.className, width: Math.round(rect.width), height: Math.round(rect.height),
          top: Math.round(rect.top), aboveFold: rect.bottom > 0 && rect.top < innerHeight && rect.width > 0 };
      });
      return { title: document.title, finalPath: location.pathname, lcp: window.__perfLab?.lcp, cls: window.__perfLab?.cls, ttfbMs: nav?.responseStart, fcpMs: paints.find(p => p.name === "first-contentful-paint")?.startTime ?? null, domNodes: document.getElementsByTagName("*").length, images, backgroundImages, links: [...document.querySelectorAll('a[href^="/dancers/"],a[href^="/venues/"]')].slice(0, 8).map(a => a.getAttribute("href")), videoCount: document.querySelectorAll("video").length, videoSources: [...document.querySelectorAll("video")].filter(v => v.currentSrc || v.getAttribute("src")).length };
    });
    initial.journeySampleMs = performance.now() - journeyStarted;
    if (route === "/" || route.includes("tab=dancers")) {
      for (const filter of ["now", "upcoming", "all"]) {
        const button = page.locator(`[data-dancer-directory-filter="${filter}"]`).first();
        if (await button.isVisible()) { await button.click(); await page.waitForTimeout(150); }
      }
    }
    const before = await cdp.send("Performance.getMetrics");
    // A repeatable five-second scroll sample; not a replacement for real field INP.
    await page.evaluate(async () => {
      const scroller = [...document.querySelectorAll("main,section,div")].find(el => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300 && ["auto", "scroll"].includes(getComputedStyle(el).overflowY)) || document.scrollingElement;
      let previous = performance.now();
      await new Promise(resolve => { const end = previous + 5000; function frame(now) { window.__perfLab.frames.push(now - previous); previous = now; scroller.scrollTop += 12; if (now < end) requestAnimationFrame(frame); else resolve(); } requestAnimationFrame(frame); });
    });
    const after = await cdp.send("Performance.getMetrics");
    const final = await page.evaluate(() => ({ ...window.__perfLab, quality: [...document.querySelectorAll("video")].map(v => { const q = v.getVideoPlaybackQuality?.(); return { paused: v.paused, readyState: v.readyState, currentTime: v.currentTime, frames: q?.totalVideoFrames ?? null, dropped: q?.droppedVideoFrames ?? null }; }) }));
    const metric = (snapshot, name) => snapshot.metrics.find(m => m.name === name)?.value ?? null;
    const result = { route, profile: profileName, customerFixture, run, browser: browser.version(), measuredAt: new Date().toISOString(), initial, final, initialTransferBytes: initialRequests.reduce((n, r) => n + r.bytes, 0), initialJsTransferBytes: initialRequests.filter(r => r.type === "Script").reduce((n, r) => n + r.bytes, 0), initialRequestCount: initialRequests.length, memory: { heapBefore: metric(before, "JSHeapUsedSize"), heapAfter: metric(after, "JSHeapUsedSize"), nodesBefore: metric(before, "Nodes"), nodesAfter: metric(after, "Nodes") }, errors, navigationError, suppressedWrites, requests: [...requests.values()] };
    results.push(result);
    await writeFile(path.join(output, "results.json"), JSON.stringify({ base, profiles, note: "Synthetic Chromium mobile lab, cold cache. Writes suppressed. INP is interaction proxy only; signed-out dashboard access is not authenticated dashboard performance.", results }, null, 2));
    console.log(JSON.stringify({ route, profile: profileName, run, lcpMs: initial.lcp?.ms, fcpMs: initial.fcpMs, ttfbMs: initial.ttfbMs, cls: initial.cls, bytes: result.initialTransferBytes, requests: result.initialRequestCount, errors: errors.length, navigationError }));
    if (run === 1) await page.screenshot({ path: path.join(output, `${profileName}-${results.length}.png`), fullPage: false, timeout: 15000 });
    await context.close();
  }
} finally { await browser.close(); }
