// Exercise the complete homepage using synthetic requests only; no production traffic.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(process.env.PERF_OUTPUT || ".qa/tv-recovery");
await mkdir(output, { recursive: true });
const clip = path.join(output, "synthetic.mp4");
await promisify(execFile)(require("ffmpeg-static"), [
  "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=purple:s=160x288:d=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip,
], { windowsHide: true, timeout: 15000 });
const clipBytes = await readFile(clip);
const html = (await readFile(path.join(root, "outputs/index.html"), "utf8")).replace("<head>", '<head><base href="/outputs/">');
const origin = "https://tv-recovery.example.test";
const videoId = "11111111-1111-4111-8111-111111111111";
const video = {
  id: videoId, videoUrl: `${origin}/synthetic.mp4`, durationSeconds: 2, width: 160, height: 288,
  publishedAt: "2026-09-12T00:00:00Z", likeCount: 0,
  dancer: { id: "22222222-2222-4222-8222-222222222222", stageName: "Recovery Fixture", slug: "recovery-fixture", city: "Las Vegas" },
  venue: null, shift: null, deals: [], dealAttributionTokens: {},
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const scenario of ["verification", "transient"]) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    const requests = [], errors = [], documents = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.addInitScript(() => {
      localStorage.setItem("dancrAgeVerified", "true");
      const nativeFetch = window.fetch.bind(window);
      window.__tvRequestModes = [];
      window.fetch = (input, options) => {
        if (typeof input === "string" && input.startsWith("/api/public/tv?")) window.__tvRequestModes.push(options?.cache);
        return nativeFetch(input, options);
      };
    });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.fulfill({ status: 204 });
      if (request.isNavigationRequest()) {
        documents.push(url.href);
        return route.fulfill({ contentType: "text/html", body: html });
      }
      if (url.pathname === "/api/public/tv") {
        requests.push(url.href);
        const recovered = scenario === "verification" ? page.url().includes("tv_refresh=") : url.searchParams.has("refresh");
        if (!recovered) return route.fulfill(scenario === "verification"
          ? { status: 403, headers: { "x-vercel-mitigated": "challenge", "content-type": "text/html" }, body: "<html>Vercel Security Checkpoint</html>" }
          : { status: 503, json: { ok: false, error: "Temporarily unavailable" } });
        return route.fulfill({ json: { ok: true, videos: [video] } });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {
        ok: true, dancers: [], venues: [], shifts: [], count: 1,
        cities: [{ value: "Las Vegas", label: "Las Vegas", dancerCount: 1, venueCount: 0 }],
      } });
      if (url.pathname === "/synthetic.mp4") return route.fulfill({ contentType: "video/mp4", body: clipBytes });
      const publicRoot = path.join(root, "public");
      const file = path.resolve(publicRoot, `.${url.pathname}`);
      if (file.startsWith(publicRoot + path.sep)) {
        try { return await route.fulfill({ path: file }); } catch { /* Unused fixture images are optional. */ }
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto(`${origin}/?view=tv&city=Las%20Vegas&tv_video=${videoId}`, { waitUntil: "load" });
    const button = page.getByRole("button", { name: scenario === "verification" ? "Reload MyDancr TV" : "Retry MyDancr TV", exact: true });
    await button.waitFor({ timeout: 15000 });
    assert.equal(documents.length, 1, "no automatic page-reload loop");
    await page.screenshot({ path: path.join(output, `${scenario}-before.png`) });
    await button.click();
    await page.locator(".home-tv-feed-slide").first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll(".home-tv-feed-video")].some(video => !video.paused && video.currentTime > .1));
    const modes = await page.evaluate(() => window.__tvRequestModes);
    assert.equal(new URL(page.url()).searchParams.get("tv_video"), videoId);
    if (scenario === "verification") assert.equal(documents.length, 2);
    else { assert.equal(documents.length, 1); assert.equal(modes.at(-1), "no-store"); }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `${scenario}-after.png`) });
    results.push({ scenario, documents, requests, modes, errors, playing: true });
    await context.close();
  }
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: true, productionRequests: 0, scenarios: results.map(result => result.scenario) }));
