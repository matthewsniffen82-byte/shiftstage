import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { liveShellRoute } from '../../tests/helpers/live-shell-route.mjs';
const { chromium, devices } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PERF_BASE_URL || 'https://www.mydancr.com';
const output = process.env.PERF_OUTPUT || '.qa/video-scroll-startup';
const local = process.env.PERF_LOCAL_SHELL === '1';
const html = local ? await (await liveShellRoute().route.GET()).text() : '';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ ...devices['Pixel 5'], serviceWorkers: 'block' });
await context.addInitScript(() => localStorage.setItem('dancrAgeVerified', 'true'));
await context.route('**/*', async route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { ok: true } });
  const url = new URL(route.request().url());
  if (local && route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: html });
  const files = { '/live-shell.js': 'outputs/live-shell-app.js', '/live-shell-feature.js': 'outputs/live-shell-tv.js', '/adaptive-video.mjs': 'public/adaptive-video.mjs' };
  if (local && files[url.pathname]) return route.fulfill({ contentType: 'text/javascript', body: await readFile(files[url.pathname]) });
  return route.continue();
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 500000, uploadThroughput: 125000 });
const errors = [], requests = [], rows = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname === '/api/media/dancer-video') requests.push({ at: Date.now(), id: url.searchParams.get('id'), mode: url.searchParams.get('hls') || 'mp4', rendition: url.searchParams.get('rendition'), range: request.headers().range });
});
try {
  await page.goto(base + '/?city=Las%20Vegas&view=tv', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.home-tv-feed-slide video')?.dataset.frameReady === 'true', null, { timeout: 45000 });
  await page.waitForTimeout(2500);
  for (const index of [1, 2, 3, 2, 1, 0]) {
    const slide = page.locator('.home-tv-feed-slide').nth(index);
    const before = await slide.evaluate(slide => {
      const video = slide.querySelector('video'), poster = video.nextElementSibling;
      return { ready: video.readyState, source: Boolean(video.getAttribute('src')), time: video.currentTime, buffered: Array.from({length:video.buffered.length},(_,i)=>[video.buffered.start(i),video.buffered.end(i)]), videoFilter: getComputedStyle(video).filter, posterFilter: getComputedStyle(poster).filter, videoOpacity: getComputedStyle(video).opacity, posterOpacity: getComputedStyle(poster).opacity };
    });
    const started = Date.now();
    await slide.evaluate(slide => slide.scrollIntoView({ block: 'start', behavior: 'instant' }));
    if (process.env.PERF_SCREENSHOTS === '1' && index === 1 && !rows.length) await page.screenshot({ path: output + '/handoff.png' });
    await page.waitForFunction(index => {
      const slide = document.querySelectorAll('.home-tv-feed-slide')[index], video = slide?.querySelector('video');
      return slide?.getAttribute('aria-current') === 'true' && !video.paused && video.dataset.frameReady === 'true';
    }, index, { timeout: 45000 });
    const startupMs = Date.now() - started;
    rows.push({ index, started, startupMs, before });
    if (process.env.PERF_SCREENSHOTS === '1' && rows.length === 1) await page.screenshot({ path: output + '/playing.png' });
    await page.waitForTimeout(2500);
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ rows, requests, errors }, null, 2));
  await context.unrouteAll({ behavior: 'wait' });
  await browser.close();
}
console.log(JSON.stringify(rows));
