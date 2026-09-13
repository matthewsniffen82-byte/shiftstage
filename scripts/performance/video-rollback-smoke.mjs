// Read-only MP4 regression journey for feed/profile playback and rapid reversals.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium, webkit, devices } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PERF_BASE_URL || 'https://www.mydancr.com';
const localApp = process.env.PERF_LOCAL_APP_URL;
const output = process.env.PERF_OUTPUT || '.qa/video-rollback';
const engine = process.env.PERF_ENGINE || 'chromium';
const expectBidirectionalPreload = process.env.PERF_EXPECT_BIDIRECTIONAL_PRELOAD === '1';
const expectForwardPreload = process.env.PERF_EXPECT_FORWARD_PRELOAD === '1' || expectBidirectionalPreload;
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chromium' ? { channel: 'msedge' } : {}) });
const context = await browser.newContext({ ...devices[engine === 'webkit' ? 'iPhone 13' : 'Pixel 5'], serviceWorkers: 'block' });
const selector = '.home-tv-feed-video, .profile-media-viewer video';
await context.addInitScript(selector => {
  localStorage.setItem('dancrAgeVerified', 'true');
  window.__videoStarts = [];
  window.__videoPlaying = [];
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.matches(selector)) window.__videoStarts.push({ othersPlaying: [...document.querySelectorAll(selector)].filter(video => video !== this && !video.paused).length });
    return nativePlay.call(this);
  };
  document.addEventListener('playing', event => {
    const video = event.target;
    if (video.matches?.(selector) && !video.paused) window.__videoPlaying.push({
      othersPlaying: [...document.querySelectorAll(selector)].filter(other => other !== video && !other.paused && other.readyState >= 2).length,
    });
  }, true);
}, selector);
await context.route('**/*', async route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fulfill({ json: { ok: true } });
  const url = new URL(route.request().url());
  if (localApp && (route.request().resourceType() === 'document' || url.pathname.startsWith('/_next/') || ['/live-shell.js', '/live-shell-feature.js', '/profile-media-card-feed.css', '/video-autoplay-recovery.js', '/outputs/live-shell.css'].includes(url.pathname))) {
    return route.fulfill({ response: await route.fetch({ url: localApp + url.pathname + url.search }) });
  }
  return route.continue();
});
const page = await context.newPage();
if (engine === 'chromium') {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 500000, uploadThroughput: 125000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}
const errors = [], consoleErrors = [], hlsRequests = [], states = [], starts = [], playing = [], failedRequests = [];
const pendingReads = new Set();
let phase = 'startup';
page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack, phase }));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('request', request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/public/') && request.method() === 'GET') pendingReads.add(request);
  if (url.searchParams.has('hls') || ['/hls-engine.js', '/adaptive-video.mjs'].includes(url.pathname)) hlsRequests.push(url.pathname + url.search);
});
page.on('requestfinished', request => pendingReads.delete(request));
page.on('requestfailed', request => {
  pendingReads.delete(request);
  failedRequests.push({ url: request.url(), failure: request.failure()?.errorText, phase });
});
// Let finite API reads settle before destroying their document. The Windows
// WebKit runner otherwise reports canceled navigation fetches as page errors.
const settleReads = async () => {
  const deadline = Date.now() + 30000;
  do {
    await page.waitForTimeout(500);
    if (!pendingReads.size) return;
  } while (Date.now() < deadline);
  throw new Error('API reads did not settle before navigation: ' + [...pendingReads].map(request => request.url()).join(', '));
};
const snapshot = async (surface, label) => {
  phase = surface + ':' + label;
  const videos = await page.locator(selector).evaluateAll(videos => videos.map(video => ({
    paused: video.paused, source: video.getAttribute('src'), ready: video.readyState, time: video.currentTime,
    preload: video.preload, buffered: Array.from({ length: video.buffered.length }, (_, index) => [video.buffered.start(index), video.buffered.end(index)]),
  })));
  assert.ok(videos.filter(video => !video.paused).length <= 1, surface + ': only one player runs');
  if (expectForwardPreload) assert.ok(videos.filter(video => video.source).length <= 5, 'Only current and two clips in either direction may have sources');
  for (const video of videos.filter(video => video.source)) assert.ok(!video.source.startsWith('blob:') && !video.source.includes('hls='), 'Normal video URL, no HLS/MSE');
  states.push({ surface, label, videos });
  return videos;
};
await mkdir(output, { recursive: true });
try {
  for (const surface of ['feed', 'profile']) {
    const slides = surface === 'feed' ? '.home-tv-feed-slide' : '.profile-media-viewer-slide';
    const url = surface === 'feed' ? '/?city=Las%20Vegas&view=tv' : '/dancers/lvdegen11?media=video&mediaIndex=0';
    await page.goto(base + url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(video => !video.paused && video.currentTime > .1), selector, { timeout: 45000 });
    assert.equal((await snapshot(surface, 'initial-playback')).filter(video => !video.paused).length, 1);
    assert.ok(await page.locator(slides).count() >= 4, 'The fixture must exercise four distinct clips');
    if (expectForwardPreload) {
      await page.waitForFunction(selector => {
        const videos = [...document.querySelectorAll(selector)];
        return videos.length >= 4 && videos[0].preload === 'auto' && !videos[0].paused && videos[0].readyState >= 2
          && videos[1].preload === 'auto' && videos[1].hasAttribute('src') && videos[1].paused
          && videos[2].preload === 'metadata' && videos[2].hasAttribute('src') && videos[2].paused
          && videos.slice(3).every(video => !video.hasAttribute('src') && video.paused);
      }, selector, { timeout: 15000 });
      await snapshot(surface, 'current-auto-next-auto-second-metadata-farther-wait');
    }
    if (expectBidirectionalPreload) {
      await page.locator(slides).nth(2).evaluate(slide => slide.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForFunction(({ selector, slides }) => {
        const currentSlide = document.querySelectorAll(slides)[2];
        const videos = [...document.querySelectorAll(selector)];
        return currentSlide?.getAttribute('aria-current') === 'true' && videos[2]?.currentTime > .1
          && videos.every((video, index) => {
            const distance = Math.abs(index - 2);
            if (distance > 2) return !video.hasAttribute('src') && video.paused;
            return video.hasAttribute('src') && video.preload === (distance <= 1 ? 'auto' : 'metadata')
              && video.paused === (distance !== 0);
          });
      }, { selector, slides }, { timeout: 30000 });
      await snapshot(surface, 'both-directions-one-strong-two-light-farther-wait');
    }
    for (const index of [1, 2, 3, 2, 1, 0]) {
      await page.locator(slides).nth(index).evaluate(slide => slide.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.waitForTimeout(250);
      await snapshot(surface, 'rapid-' + index);
    }
    // Center the final card before the separate background/resume check. During
    // a rapid series, native scroll snapping can finish after the last sample.
    await page.locator(slides).first().evaluate(slide => slide.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(slides => {
      const slide = document.querySelector(slides), video = slide?.querySelector('video');
      return slide?.getAttribute('aria-current') === 'true' && video && !video.paused && video.readyState >= 2 && video.currentTime > .1;
    }, slides, { timeout: 45000 });
    await snapshot(surface, 'settled');
    await page.evaluate(() => { window.__visibility = 'hidden'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__visibility }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    assert.ok((await snapshot(surface, 'simulated-hidden')).every(video => video.paused));
    await page.evaluate(() => { window.__visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(video => !video.paused), selector);
    await snapshot(surface, 'resumed');
    await page.evaluate(() => { delete document.visibilityState; delete window.__visibility; });
    await settleReads();
    if (surface === 'feed') await page.locator('[data-tab="dancers"]').first().click();
    else await page.locator('.profile-media-viewer-close').click();
    assert.ok((await snapshot(surface, 'closed')).every(video => !video.source && video.paused));
    await settleReads();
    starts.push(...await page.evaluate(() => window.__videoStarts));
    playing.push(...await page.evaluate(() => window.__videoPlaying));
  }
  // A play() request can precede pause() in the same historical synchronous
  // selection loop; verify actual playback events, not that call ordering.
  assert.ok(playing.length >= 2, 'Both journeys must produce native playback events');
  assert.deepEqual(playing.filter(event => event.othersPlaying > 0), [], 'Only one decoded video plays at a time');
  assert.deepEqual(hlsRequests, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors.filter(message => message !== 'Viewport argument key "interactive-widget" not recognized and ignored.'), []);
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ engine, localApp, expectForwardPreload, expectBidirectionalPreload, states, starts, playing, hlsRequests, errors, consoleErrors, failedRequests }, null, 2));
  await context.unrouteAll({ behavior: 'wait' });
  await browser.close();
}
console.log(JSON.stringify({ engine, passed: true, phases: states.length, playbackOverlap: playing.filter(event => event.othersPlaying > 0).length, playRequestOverlap: starts.filter(start => start.othersPlaying > 0).length, hlsRequests: hlsRequests.length, errors, consoleErrors }));
