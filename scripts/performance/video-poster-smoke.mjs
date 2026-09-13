// Read-only mobile checks for the preview-to-video handoff, including rapid reversals.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium, webkit, devices } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PERF_BASE_URL || 'https://www.mydancr.com';
const localApp = process.env.PERF_LOCAL_APP_URL;
const output = process.env.PERF_OUTPUT || '.qa/video-poster';
const engine = process.env.PERF_ENGINE || 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({headless:true,...(engine==='chromium'?{channel:'msedge'}:{})});
const context = await browser.newContext({...devices[engine==='webkit'?'iPhone 13':'Pixel 5'],serviceWorkers:'block'});
await context.addInitScript(() => {
  localStorage.setItem('dancrAgeVerified', 'true');
  window.__posterFrames = [];
  window.__posterOverlap = [];
  const nativeFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
  if (nativeFrame) HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
    return nativeFrame.call(this, (now, metadata) => {
      const poster = this.nextElementSibling;
      const tracked = poster?.matches('.home-tv-feed-poster, .profile-media-video-poster');
      const before = tracked ? getComputedStyle(poster).visibility : null;
      callback(now, metadata);
      if (tracked && this.isConnected) window.__posterFrames.push({
        before, after: getComputedStyle(poster).visibility,
        decoded: poster.naturalWidth > 0, presented: this.dataset.frameReady === 'true',
      });
    });
  };
  document.addEventListener('playing', event => {
    const video = event.target;
    if (!video.matches?.('.home-tv-feed-video, .profile-tv-viewer-video, .profile-media-viewer video')) return;
    window.__posterOverlap.push([...document.querySelectorAll('.home-tv-feed-video, .profile-tv-viewer-video, .profile-media-viewer video')].filter(v=>!v.paused && v.readyState>=2).length);
    if (!nativeFrame && video.dataset.frameReady !== 'true') {
      const poster = video.nextElementSibling;
      if (!poster?.matches('.home-tv-feed-poster, .profile-media-video-poster')) return;
      const before = getComputedStyle(poster).visibility;
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        if (video.isConnected && !video.paused && video.dataset.frameReady === 'true') window.__posterFrames.push({
          before, after: getComputedStyle(poster).visibility, decoded: poster.naturalWidth > 0,
          presented: true, fallback: 'playing-then-paint',
        });
      })));
    }
  }, true);
});
await context.route('**/*', async route => {
  const request=route.request(), url=new URL(request.url());
  if (!['GET','HEAD','OPTIONS'].includes(request.method())) return route.fulfill({json:{ok:true}});
  if (localApp && (request.resourceType()==='document' || url.pathname.startsWith('/_next/') || ['/live-shell.js','/live-shell-feature.js','/profile-media-card-feed.css','/outputs/live-shell.css'].includes(url.pathname))) {
    return route.fulfill({response:await route.fetch({url:localApp+url.pathname+url.search})});
  }
  return route.continue();
});
const page=await context.newPage(), errors=[], consoleErrors=[], results=[], frames=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', e=>{if(e.type()==='error') consoleErrors.push(e.text());});
if(engine==='chromium') {
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:500000,uploadThroughput:125000});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
}
const check = async (surface, selector) => {
  await page.waitForFunction(selector => {
    const cards=[...document.querySelectorAll(selector)];
    return cards.length>=4 && cards[0].querySelector('video')?.dataset.frameReady==='true' && cards.slice(1,3).every(card=>{
      const video=card.querySelector('video'), poster=video?.nextElementSibling;
      return video?.paused && poster?.naturalWidth>0 && getComputedStyle(poster).visibility==='visible';
    });
  },selector,{timeout:45000});
  const initial=await page.locator(selector).evaluateAll(cards=>cards.slice(0,3).map(card=>{
    const video=card.querySelector('video'), poster=video.nextElementSibling;
    return {paused:video.paused,preload:video.preload,time:video.currentTime,posterDecoded:poster.naturalWidth>0,posterVisible:getComputedStyle(poster).visibility,frameReady:video.dataset.frameReady||null};
  }));
  assert.equal(initial[0].preload,'auto');
  assert.equal(initial[1].preload,'auto');
  assert.equal(initial[2].preload,'metadata');
  assert.deepEqual(initial.slice(1).map(v=>v.frameReady),[null,null]);
  await page.screenshot({path:`${output}/${surface}-previews.png`,fullPage:false});
  for(const index of [1,2,3,2,1,0]) {
    await page.locator(selector).nth(index).evaluate(card=>card.scrollIntoView({block:'center',behavior:'instant'}));
    await page.waitForTimeout(250);
    const state=await page.locator(selector).evaluateAll(cards=>cards.map(card=>{
      const video=card.querySelector('video'), poster=video.nextElementSibling;
      return {playing:!video.paused&&video.readyState>=2,source:video.hasAttribute('src'),frameReady:video.dataset.frameReady==='true',poster:!!poster?.getAttribute('src')};
    }));
    assert.ok(state.filter(v=>v.playing).length<=1);
    assert.ok(state.filter(v=>v.source).length<=5);
    assert.ok(state[index].frameReady||state[index].poster,'Incoming cards have a preview or a presented video frame');
  }
  await page.locator(selector).first().evaluate(card=>card.scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForFunction(selector=>{
    const v=document.querySelector(selector)?.querySelector('video');
    return v&&!v.paused&&v.currentTime>.1&&v.dataset.frameReady==='true';
  },selector,{timeout:45000});
  results.push({surface,initial,rapidReversals:'pass'});
};
try {
  await mkdir(output,{recursive:true});
  const catalog=await fetch(base+'/api/public/tv?city=Las%20Vegas&limit=50').then(r=>r.json());
  const clip=catalog.videos.find(v=>v.dancer?.slug==='lvdegen11'&&v.distributionScope==='profile_and_feed');
  assert.ok(clip,'A public profile with several clips is required');
  await page.goto(base+'/?city=Las%20Vegas&view=tv&tv_video='+encodeURIComponent(clip.id),{waitUntil:'load',timeout:60000});
  await check('tv','.home-tv-feed-slide');
  await page.locator('.home-tv-feed-slide[aria-current="true"] .home-tv-feed-dancer').click();
  await page.locator('#profileBackdrop.show').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#modalMediaTvTab')?.disabled,null,{timeout:30000});
  await page.locator('#modalMediaTvTab').click();
  await page.locator('#modalGallery [data-profile-tv-index]').first().click();
  await check('profile-overlay','.profile-tv-viewer-slide');
  assert.equal(await page.locator('.home-tv-feed-video').evaluateAll(videos=>videos.filter(v=>!v.paused).length),0);
  frames.push(...await page.evaluate(()=>window.__posterFrames));
  assert.ok((await page.evaluate(()=>window.__posterOverlap)).every(n=>n<=1));
  await page.locator('[data-close-profile-tv]').click();
  await page.locator('#modalClose').click();
  await page.waitForTimeout(1000);
  await page.goto(base+'/dancers/lvdegen11?media=video&mediaIndex=0',{waitUntil:'load',timeout:60000});
  await check('profile-route','.profile-media-viewer-slide');
  frames.push(...await page.evaluate(()=>window.__posterFrames));
  assert.ok((await page.evaluate(()=>window.__posterOverlap)).every(n=>n<=1));
  assert.ok(frames.length>=3,'All surfaces present native video frames');
  assert.ok(frames.every(f=>f.before==='visible'&&f.after==='hidden'&&f.presented),'Posters stay visible until the native presentation callback');
  assert.deepEqual(errors,[]);
  assert.deepEqual(consoleErrors.filter(m=>m!=='Viewport argument key "interactive-widget" not recognized and ignored.'),[]);
} finally {
  await writeFile(`${output}/results.json`,JSON.stringify({engine,localApp,results,frames,errors,consoleErrors},null,2));
  await context.unrouteAll({behavior:'wait'});
  await browser.close();
}
console.log(JSON.stringify({engine,passed:true,surfaces:results.map(r=>r.surface),frameHandoffs:frames.length,errors}));
