// Deterministic mobile first-frame regression: all browser requests stay in this fixture.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import sharp from "sharp";

const { chromium, webkit } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || "playwright");
const workspace = await mkdtemp(path.join(os.tmpdir(), "mydancr-video-presentation-"));
const mediaPath = path.join(workspace, "video.mp4");
const results = [];
let browser;
try {
  await promisify(execFile)(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "color=c=0x22aa55:s=320x568:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", mediaPath], { windowsHide: true });
  const media = await readFile(mediaPath);
  const helper = (await readFile("src/lib/dancr/video-frame-presentation.mjs", "utf8")).replace("export function", "function");
  const live = await readFile("outputs/index.html", "utf8");
  const profileCss = await readFile("public/profile-media-card-feed.css", "utf8");
  const tv = await readFile("app/tv/TvFeedClient.tsx", "utf8");
  const rules = (source, selector) => [...source.matchAll(new RegExp(`[^{}]*${selector}[^{}]*\\{[^{}]*\\}`, "g"))]
    .map((match) => match[0]).join("\n");
  const posterCss = rules(live, "\\.home-tv-feed-video-poster") + rules(tv, "\\.tv-video-poster") +
    rules(profileCss, "\\.profile-media-video-poster");
  const engine = process.env.PERF_BROWSER || "chromium";
  browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
  for (const fallback of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/video.mp4") {
        const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
        return route.fulfill({ status: range ? 206 : 200, contentType: "video/mp4",
          headers: { "accept-ranges": "bytes", "content-length": String(end - start + 1),
            ...(range ? { "content-range": `bytes ${start}-${end}/${media.length}` } : {}) },
          body: media.subarray(start, end + 1) });
      }
      if (url.pathname === "/poster.svg") return route.fulfill({ contentType: "image/svg+xml", body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="568"><path fill="#cc3333" d="M0 0h320v568H0z"/></svg>' });
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{margin:0;background:#000}.card{position:relative;width:320px;height:568px;margin-bottom:12px}
        video{display:block;width:100%;height:100%;object-fit:cover}${posterCss}</style>
        <div class="profile-media-card-feed"><section class="card profile-tv-viewer-slide"><video muted playsinline loop></video><img class="profile-media-video-poster" src="/poster.svg"></section></div>
        <section class="card home-tv-feed-slide"><video class="home-tv-feed-video" muted playsinline loop></video><img class="home-tv-feed-video-poster" src="/poster.svg"></section>
        <section class="card tv-player"><video muted playsinline loop></video><img class="tv-video-poster" src="/poster.svg"></section>
        <script>${helper}
        window.players = [...document.querySelectorAll('video')];
        window.releaseFrame = () => {};
        players.forEach(video => {
          ${fallback ? "video.requestVideoFrameCallback = undefined;" : `const nativeFrame = video.requestVideoFrameCallback.bind(video);
          video.requestVideoFrameCallback = callback => nativeFrame((...args) => { window.releaseFrame = () => callback(...args); });`}
          observeVideoPresentation(video);
        });</script>` });
    });
    await page.goto("https://video-presentation.test/");
    for (const index of [0, 1, 2, 1, 0]) {
      await page.evaluate((active) => {
        players.forEach(video => video.pause());
        const video = players[active];
        video.parentElement.scrollIntoView();
        video.removeAttribute("src");
        video.load();
        video.src = "/video.mp4";
        window.releaseFrame = null;
        video.muted = true;
        void video.play().catch(error => { window.playError = error.message; });
      }, index);
      await page.waitForFunction((active) => players[active].currentTime > .05, index).catch(async (error) => {
        console.error(await page.evaluate(() => ({ playError: window.playError, players: players.map(video => ({
          codec: video.canPlayType('video/mp4; codecs="avc1.42E01E"'), ready: video.readyState,
          network: video.networkState, paused: video.paused, error: video.error?.message,
        })) })));
        throw error;
      });
      const card = page.locator(".card").nth(index);
      if (!fallback) {
        await page.waitForFunction(() => typeof window.releaseFrame === "function");
        assert.equal(await page.locator("video").nth(index).getAttribute("data-frame-ready"), null);
        const covered = await sharp(await card.screenshot()).extract({ left: 120, top: 220, width: 80, height: 80 }).stats();
        assert.ok(covered.channels[0].mean > 180 && covered.channels[1].mean < 80, "poster stays red while frame presentation is delayed");
        await page.evaluate(() => window.releaseFrame());
      }
      await page.waitForFunction((active) => players[active].dataset.frameReady === "true", index);
      const revealed = await sharp(await card.screenshot()).extract({ left: 120, top: 220, width: 80, height: 80 }).stats();
      assert.ok(revealed.channels[1].mean > 140 && revealed.channels[0].mean < 70, "the revealed player shows its green frame without a blank cover");
      results.push({ engine, fallback, index, passed: true });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser?.close();
  await unlink(mediaPath).catch(() => {});
  await rmdir(workspace);
}
