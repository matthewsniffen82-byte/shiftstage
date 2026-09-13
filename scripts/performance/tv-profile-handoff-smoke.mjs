// Read-only regression: a full profile must own playback above the mounted TV feed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium, webkit, devices } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.PERF_ENGINE || 'chromium';
const base = process.env.PERF_BASE_URL || 'https://www.mydancr.com';
const output = process.env.PERF_OUTPUT || '.qa/tv-profile-handoff';
const localShell = process.env.PERF_LOCAL_SHELL === '1';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chromium' ? { channel: 'msedge' } : {}) });
const desktop = process.env.PERF_DESKTOP === '1';
const context = await browser.newContext({ ...(desktop ? { viewport: { width: 1440, height: 1000 } } : devices[engine === 'webkit' ? 'iPhone 13' : 'Pixel 5']), serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('dancrAgeVerified', 'true');
  const NativeObserver = window.IntersectionObserver;
  window.IntersectionObserver = class extends NativeObserver {
    constructor(callback, options) { super(callback, options); this.retryVisible = callback; }
    observe(target) {
      if (target.matches('.home-tv-feed-slide')) window.__feedObserver = this;
      super.observe(target);
    }
  };
});
await context.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({ json: { ok: true } }));
if (localShell) {
  const shell = await readFile('outputs/live-shell-app.js', 'utf8');
  const recovery = await readFile('public/video-autoplay-recovery.js', 'utf8');
  const tvFeature = await readFile('outputs/live-shell-tv.js', 'utf8');
  await context.route('**/live-shell.js?*', route => route.fulfill({ contentType: 'application/javascript', body: shell }));
  await context.route('**/video-autoplay-recovery.js?*', route => route.fulfill({ contentType: 'application/javascript', body: recovery }));
  await context.route('**/live-shell-feature.js?*', route => route.fulfill({ contentType: 'application/javascript', body: tvFeature }));
}
const page = await context.newPage();
const states = [], errors = [], consoleErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const capture = async label => {
  const state = await page.evaluate(label => ({
    label, profileOpen: document.querySelector('#profileBackdrop')?.classList.contains('show'),
    feed: [...document.querySelectorAll('.home-tv-feed-video')].map(video => ({ paused: video.paused, time: video.currentTime, preload: video.preload, source: video.getAttribute('src'), autoplay: video.autoplay })),
    profilePlaying: [...document.querySelectorAll('.profile-tv-viewer-video')].filter(video => !video.paused).length,
    originalConnected: window.__originalFeedVideo?.isConnected,
  }), label);
  states.push(state);
  assert.ok(state.feed.filter(video => !video.paused).length + state.profilePlaying <= 1, 'Only one video plays across feed and profile');
  if (state.profileOpen) assert.ok(state.feed.every(video => video.paused && !video.autoplay), 'The covered TV feed must be paused with autoplay disabled');
  return state;
};
try {
  await mkdir(output, { recursive: true });
  const catalog = await fetch(base + '/api/public/tv?city=Las%20Vegas&limit=50').then(response => response.json());
  const clip = catalog.videos?.find(video => video.distributionScope === 'profile_and_feed' && video.dancer?.slug === 'lvdegen11')
    || catalog.videos?.find(video => video.distributionScope === 'profile_and_feed' && video.dancer?.slug);
  assert.ok(clip, 'A feed clip with profile videos is required');
  await page.goto(base + '/?city=Las%20Vegas&view=tv&tv_video=' + encodeURIComponent(clip.id), { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('.home-tv-feed-video')].some(video => !video.paused && video.currentTime > .1), null, { timeout: 45000 });
  const active = page.locator('.home-tv-feed-slide[aria-current="true"]');
  await page.evaluate(() => { window.__originalFeedVideo = document.querySelector('.home-tv-feed-slide[aria-current="true"] video'); });
  await capture('feed-playing');
  await active.locator('.home-tv-feed-dancer').click();
  await page.locator('#profileBackdrop.show').waitFor();
  await page.waitForTimeout(500);
  assert.equal((await capture('full-profile-open')).originalConnected, true, 'Exercise the mounted-feed modal transition');
  await page.evaluate(() => {
    const video = window.__originalFeedVideo;
    // An overlay can cover a card while geometric intersection still reports
    // it as visible. Deliver that late callback to exercise the restart race.
    window.__feedObserver.retryVisible([{ target: video.closest('.home-tv-feed-slide'), isIntersecting: true, intersectionRatio: 1 }], window.__feedObserver);
    for (const type of ['loadedmetadata', 'loadeddata', 'canplay']) video.dispatchEvent(new Event(type));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    const marker = document.createElement('span'); document.body.appendChild(marker); marker.remove();
  });
  await page.waitForTimeout(700);
  await capture('late-visible-intersection-and-recovery-events-while-profile-open');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  await capture('simulated-tab-return-while-profile-open');
  await page.waitForFunction(() => !document.querySelector('#modalMediaTvTab')?.disabled, null, { timeout: 30000 });
  await page.locator('#modalMediaTvTab').click();
  await page.locator('#modalGallery [data-profile-tv-index]').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.profile-tv-viewer-video')].some(video => !video.paused && video.currentTime > .1), null, { timeout: 30000 });
  assert.equal((await capture('profile-video-playing')).profilePlaying, 1);
  await page.locator('[data-close-profile-tv]').click();
  await page.waitForTimeout(400);
  await capture('profile-video-closed-full-profile-still-open');
  await page.locator('#modalClose').click();
  await page.waitForFunction(() => window.__originalFeedVideo?.isConnected && !window.__originalFeedVideo.paused, null, { timeout: 15000 });
  await capture('returned-to-same-feed-video');
  await active.locator('video').press('Space');
  await page.waitForFunction(() => window.__originalFeedVideo.paused);
  await active.locator('.home-tv-feed-dancer').click();
  await page.locator('#profileBackdrop.show').waitFor();
  await page.waitForTimeout(400);
  await capture('manually-paused-profile-open');
  await page.locator('#modalClose').click();
  await page.waitForTimeout(700);
  assert.ok((await capture('manual-pause-preserved-on-return')).feed.every(video => video.paused));
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors.filter(message => message !== 'Viewport argument key "interactive-widget" not recognized and ignored.'), []);
} finally {
  await writeFile(output + '/results.json', JSON.stringify({ engine, desktop, localShell, simulatedLateIntersection: true, states, errors, consoleErrors }, null, 2));
  await context.unrouteAll({ behavior: 'wait' });
  await browser.close();
}
console.log(JSON.stringify({ passed: true, engine, localShell, phases: states.length, errors, consoleErrors }));
