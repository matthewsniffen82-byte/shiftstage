import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shell = readFileSync('outputs/index.html', 'utf8');
const recovery = readFileSync('public/video-autoplay-recovery.js', 'utf8');
const source = name => shell.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))?.[0];
function fixture({ manual = false } = {}) {
  const classes = new Set();
  const classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name), toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) };
  const state = { profileOpen: false, profileVideo: null, starts: 0 };
  const videos = [0, 1, 2].map(index => {
    const slide = { dataset: { videoId: String(index), ...(manual && index === 0 ? { userPaused: 'true' } : {}) },
      getAttribute: () => index === 0 ? 'true' : null, classList: { add() {}, remove() {} } };
    return { slide, attrs: new Set(['src']), dataset: {}, isConnected: true, paused: index !== 0 || manual, preload: 'auto', currentTime: 12.5,
      closest: () => slide, hasAttribute(name) { return this.attrs.has(name); }, removeAttribute(name) { this.attrs.delete(name); },
      setAttribute(name) { this.attrs.add(name); }, addEventListener() {}, pause() { this.paused = true; },
      play() { this.paused = false; state.starts++; return Promise.resolve(); } };
  });
  const hiddenPanel = { classList: { contains: () => false } };
  const document = {
    visibilityState: 'visible', body: { classList }, addEventListener() {},
    querySelectorAll: selector => selector === '.home-tv-feed-video' ? videos : [...videos, ...(state.profileVideo ? [state.profileVideo] : [])],
    querySelector: selector => selector.startsWith('.page-panel.show') ? state.profileOpen ? {} : null
      : selector.includes('aria-pressed') ? null : selector.startsWith('.home-tv-feed-slide') ? videos[0].slide : null,
  };
  const context = vm.createContext({
    document, window: { addEventListener() {} }, MutationObserver: class { observe() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    profileBackdrop: { classList: { contains: () => state.profileOpen } },
    dancerSignupPage: hiddenPanel, stripeCheckoutPage: hiddenPanel, authPage: hiddenPanel, authForm: { hidden: true },
    pageSuspendedVideos: new Set(), activeProfileTvViewerVideo: () => state.profileVideo,
    releaseDeferredVideoSource(video) { video.removeAttribute('src'); context.pageSuspendedVideos.delete(video); },
    activateHomeTvFeedVideo(id) { void videos[Number(id)].play(); }, playProfileTvViewerVideo(video) { void video.play(); },
    syncProfileDestinationNavigation() {},
    homeTvLandingPreload: { clear() {} },
  });
  vm.runInContext(['homeTvFeedCoveredByProfile', 'suspendPageVideoPlayback', 'resumePageVideoPlayback', 'syncOverlayScrollLock'].map(source).join('\n'), context);
  vm.runInContext(recovery.replace(/\}\)\(\);\s*$/, 'globalThis.recovery = { scanHomeFeedVideos, playActiveVideo, isActiveHomeFeedVideo };})();'), context);
  return { state, videos, context, classes, sync: () => context.syncOverlayScrollLock() };
}

test('opening a full profile pauses the mounted feed immediately and retains its playback position', () => {
  const f = fixture();
  f.state.profileOpen = true; f.sync();
  assert.ok(f.videos.every(video => video.paused && !video.autoplay && video.preload === 'none'));
  assert.equal(f.videos[0].currentTime, 12.5);
  assert.equal(f.videos[0].hasAttribute('src'), true);
  assert.ok(f.videos.slice(1).every(video => !video.hasAttribute('src')));
});

test('ready events and recovery scans cannot revive geometrically visible feed videos under a profile', async () => {
  for (const marker of ['profile-full-view-open', 'profile-tv-viewer-open']) {
    const f = fixture(); f.classes.add(marker);
    assert.equal(f.context.homeTvFeedCoveredByProfile(), true);
    // Keep aria-current and viewport geometry active to reproduce overlay occlusion.
    f.context.recovery.scanHomeFeedVideos();
    await f.context.recovery.playActiveVideo(f.videos[0]);
    assert.equal(f.context.recovery.isActiveHomeFeedVideo(f.videos[0]), false);
    assert.ok(f.videos.every(video => video.paused && !video.autoplay));
    assert.equal(f.state.starts, 0);
  }
});

test('nested profile overlays do not pause the profile player or resume the underlying feed', () => {
  const f = fixture(); f.state.profileOpen = true; f.sync();
  const profile = { paused: false, pause() { this.paused = true; } };
  f.state.profileVideo = profile;
  f.sync(); f.sync();
  assert.equal(profile.paused, false);
  f.state.profileVideo = null; f.sync();
  assert.ok(f.videos.every(video => video.paused));
});

test('closing the full profile resumes the same feed video while preserving a manual pause', async () => {
  for (const manual of [false, true]) {
    const f = fixture({ manual });
    f.state.profileOpen = true; f.sync();
    f.state.profileOpen = false; f.sync();
    f.context.recovery.scanHomeFeedVideos();
    await Promise.resolve();
    assert.equal(f.videos[0].paused, manual);
    assert.equal(f.videos[0].currentTime, 12.5);
    assert.equal(f.videos[0].hasAttribute('src'), true);
    assert.equal(f.state.starts, manual ? 0 : 1);
  }
});

test('returning from a hidden tab keeps the covered feed paused and preserves its later resume intent', () => {
  const f = fixture(); f.state.profileOpen = true; f.sync();
  f.context.document.visibilityState = 'hidden'; f.context.suspendPageVideoPlayback();
  f.context.document.visibilityState = 'visible'; f.context.resumePageVideoPlayback();
  assert.ok(f.videos.every(video => video.paused));
  f.state.profileOpen = false; f.sync();
  assert.equal(f.videos[0].paused, false);
  assert.equal(f.state.starts, 1);
});
