import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const shell = readFileSync('outputs/index.html', 'utf8');
const carousel = readFileSync('app/dancers/[slug]/DancerPhotoCarousel.tsx', 'utf8');
const profile = readFileSync('app/dancers/[slug]/PublicDancerProfile.tsx', 'utf8');
const code = ts.transpileModule(readFileSync('src/lib/dancr/public-video-playback.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const source = name => shell.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))?.[0];
const original = 'https://app.example/api/media/dancer-video?id=video-id';

function helpers(agent = 'iPhone Safari', phone = true) {
  const context = vm.createContext({ URL, exports: {}, navigator: { userAgent: agent },
    window: { location: { href: 'https://app.example/', origin: 'https://app.example' }, matchMedia: () => ({ matches: phone }) },
  });
  vm.runInContext(code, context);
  vm.runInContext([source('homeTvPlaybackVideoUrl'), source('fallbackPublicVideoSource')].join('\n'), context);
  return context;
}

test('profile and TV players select identical existing mobile copies, preserving preview tokens', () => {
  for (const [agent, phone, mobile] of [['iPhone Safari', true, true], ['Android Chrome', true, true],
    ['Android', false, false], ['Macintosh', false, false], ['iPad Safari', true, false]]) {
    const h = helpers(agent, phone);
    for (const videoUrl of [original, original + '&preview=scoped-token', '/api/media/dancer-video?id=video-id']) {
      const item = { videoUrl, mobilePlaybackAvailable: true };
      const expected = mobile ? new URL(videoUrl, 'https://app.example/').href + '&playback=mobile' : videoUrl;
      assert.equal(h.exports.publicVideoPlaybackUrl(item), expected);
      assert.equal(h.homeTvPlaybackVideoUrl(item), expected);
      assert.equal(h.exports.publicVideoPlaybackUrl({ videoUrl }), videoUrl, 'no extra redirect for clips without a derivative');
    }
    for (const videoUrl of ['https://other.example/api/media/dancer-video?id=x', '/api/internal/media/video?id=x', '/api/media/dancer-video', 'blob:private-video']) {
      const item = { videoUrl, mobilePlaybackAvailable: true };
      assert.equal(h.exports.publicVideoPlaybackUrl(item), videoUrl);
      assert.equal(h.homeTvPlaybackVideoUrl(item), videoUrl);
    }
  }
  const server = vm.createContext({ exports: {} });
  vm.runInContext(code, server);
  assert.equal(server.exports.publicVideoPlaybackUrl({ videoUrl: original, mobilePlaybackAvailable: true }), original);
});

test('both profile fallback implementations retry once, retain time and leave playback to the active viewer', () => {
  const h = helpers();
  for (const fallback of [h.fallbackPublicVideoSource, h.exports.fallbackPublicVideoSource]) {
    const listeners = {};
    const video = { dataset: { videoUrl: original + '&playback=mobile', fullVideoUrl: original, frameReady: 'true' },
      currentTime: 3, duration: 8, hasAttribute: () => true,
      addEventListener: (event, handler) => { listeners[event] = handler; },
      play() { assert.fail('fallback alone must not start background playback'); },
    };
    assert.equal(fallback(video), true);
    assert.equal(video.src, original);
    assert.equal(video.dataset.frameReady, undefined);
    video.currentTime = 0;
    listeners.loadedmetadata();
    assert.equal(video.currentTime, 3);
    assert.equal(fallback(video), false);
    assert.equal(fallback({ ...video, dataset: { videoUrl: 'mobile', fullVideoUrl: original }, hasAttribute: () => false }), false);
  }
});

test('profile serialization retains mobile availability and attaches sources only on opening', () => {
  assert.match(profile, /mobilePlaybackAvailable: video.mobilePlaybackAvailable/);
  assert.match(carousel, /preload="none"\s*data-video-url=\{publicVideoPlaybackUrl\(item\)\}\s*data-full-video-url=\{item.videoUrl\}/);
  assert.match(source('renderProfileTvViewerSlides'), /video.dataset.videoUrl = homeTvPlaybackVideoUrl\(item\)/);
  assert.match(source('renderProfileTvViewerSlides'), /video.dataset.fullVideoUrl = String\(item.videoUrl/);
});

test('routed profile fallback resumes only the active, visible, unpaused video', () => {
  const start = carousel.indexOf('                      const video = event.currentTarget;', carousel.indexOf('onEmptied='));
  const end = carousel.indexOf('\n                    }}', start);
  assert.ok(start > 0 && end > start);
  const handler = new Function('event', 'index', 'viewerIndex', 'document', 'fallbackPublicVideoSource', carousel.slice(start, end));
  for (const [active, hidden, paused, plays] of [[true, false, false, 1], [false, false, false, 0], [true, true, false, 0], [true, false, true, 0]]) {
    let count = 0;
    const video = { dataset: { videoUrl: 'mobile', fullVideoUrl: original, userPaused: paused ? 'true' : undefined },
      currentTime: 0, hasAttribute: () => true, play: () => { count++; return Promise.resolve(); },
    };
    handler({ currentTarget: video }, 1, active ? 1 : 0, { visibilityState: hidden ? 'hidden' : 'visible' }, helpers().exports.fallbackPublicVideoSource);
    assert.equal(count, plays);
    assert.equal(video.src, original);
  }
});

test('inline profile fallback respects current selection, closed overlays and manual pause', () => {
  const render = source('renderProfileTvViewerSlides');
  const start = render.indexOf('          if (fallbackPublicVideoSource(video)');
  const end = render.indexOf('\n        });', start);
  assert.ok(start > 0 && end > start);
  const handler = new Function('video', 'overlay', 'document', 'fallbackPublicVideoSource', 'activeProfileTvViewerVideo', 'playProfileTvViewerVideo', render.slice(start, end));
  for (const [active, hidden, closed, paused, plays] of [[true, false, false, false, 1], [false, false, false, false, 0],
    [true, true, false, false, 0], [true, false, true, false, 0], [true, false, false, true, 0]]) {
    let count = 0;
    const video = { dataset: { videoUrl: 'mobile', fullVideoUrl: original, userPaused: paused ? 'true' : undefined }, currentTime: 0, hasAttribute: () => true };
    handler(video, { hidden: closed }, { visibilityState: hidden ? 'hidden' : 'visible' }, helpers().fallbackPublicVideoSource,
      () => active ? video : null, () => { count++; });
    assert.equal(count, plays);
    assert.equal(video.src, original);
  }
});
