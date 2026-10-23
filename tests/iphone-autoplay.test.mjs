import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const soundSource = readFileSync('public/video-sound-preference.js', 'utf8');
const recoverySource = readFileSync('public/video-autoplay-recovery.js', 'utf8');
const shell = readFileSync('outputs/index.html', 'utf8');
const source = name => shell.match(new RegExp('    (?:async )?function ' + name + '\\([^]*?\\n    \\}'))?.[0];

function fixture() {
  const documentListeners = {}, windowListeners = {}, timers = [], mutations = [], attempts = [];
  const storage = new Map([['mydancr.video-sound-muted.v1', 'sound-on']]);
  let gesture = false, syntheticClicks = 0, denyMuted = false;
  const classes = new Set();
  const slide = { dataset: {}, getAttribute: () => 'true',
    classList: { contains: name => classes.has(name), add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)) },
    querySelector: () => video };
  const emit = (type, target) => documentListeners[type]?.forEach(fn => fn({ target }));
  class Element {
    querySelectorAll() { return []; }
  }
  class Video extends Element {
    dataset = {}; attrs = new Map(); paused = true; _muted = true;
    get muted() { return this._muted; }
    set muted(value) {
      if (value === this._muted) return;
      this._muted = value;
      if (!value && !gesture) this.paused = true;
      emit('volumechange', this);
    }
    matches() { return true; }
    closest(selector) { return selector === '.home-tv-feed-slide' ? slide : null; }
    setAttribute(name, value) { this.attrs.set(name, value); }
    removeAttribute(name) { this.attrs.delete(name); }
    addEventListener() {}
    pause() { this.paused = true; }
    play() {
      attempts.push(this.muted);
      if (!gesture && (!this.muted || denyMuted)) return Promise.reject({ name: 'NotAllowedError' });
      this.paused = false;
      emit('play', this);
      return this.paused ? Promise.reject({ name: 'NotAllowedError' }) : Promise.resolve();
    }
  }
  const video = new Video();
  class Control extends Element {
    matches(selector) { return selector === '[data-home-tv-sound]'; }
    closest(selector) { return selector === '.home-tv-feed-slide' ? slide : this; }
    getAttribute() { return String(!video.muted); }
    click() { syntheticClicks++; }
  }
  const control = new Control();
  const document = {
    visibilityState: 'visible', documentElement: {}, body: { classList: { contains: () => false } },
    addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn); },
    querySelectorAll() { return [video]; },
    querySelector(selector) { return selector.includes('data-home-tv-sound') ? control : slide; },
  };
  const window = {
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    dispatchEvent(event) { windowListeners[event.type]?.forEach(fn => fn(event)); },
    setTimeout(fn) { timers.push(fn); }, requestAnimationFrame(fn) { timers.push(fn); return timers.length; }, cancelAnimationFrame() {},
  };
  const context = vm.createContext({ document, window, Element, HTMLVideoElement: Video,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    MutationObserver: class { constructor(fn) { mutations.push(fn); } observe() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  });
  vm.runInContext(soundSource, context);
  vm.runInContext(recoverySource.replace(/\}\)\(\);\s*$/, 'globalThis.recovery = { playActiveVideo, scanHomeFeedVideos };})();'), context);
  return { video, slide, classes, document, context, attempts, storage,
    get syntheticClicks() { return syntheticClicks; },
    setDenyMuted(value) { denyMuted = value; },
    async play() { await context.recovery.playActiveVideo(video); },
    scan() { context.recovery.scanHomeFeedVideos(); },
    mutate() { mutations.forEach(fn => fn([{ addedNodes: [video] }])); timers.splice(0).forEach(fn => fn()); },
    soundClick() {
      gesture = true;
      documentListeners.click.forEach(fn => fn({ target: control, isTrusted: true }));
      video.muted = !video.muted;
      timers.splice(0).forEach(fn => fn());
      gesture = false;
    },
  };
}

test('saved sound-on cannot undo the iPhone muted retry through play, volume or DOM updates', async () => {
  const f = fixture(); await f.play();
  assert.deepEqual(f.attempts, [false, true]);
  assert.equal(f.video.paused, false); assert.equal(f.video.muted, true);
  assert.equal(f.video.dataset.autoplayMuted, 'true');
  assert.equal(f.storage.get('mydancr.video-sound-muted.v1'), 'sound-on');
  f.scan(); f.mutate();
  assert.equal(f.video.paused, false); assert.equal(f.video.muted, true);
  assert.equal(f.syntheticClicks, 0, 'preference syncing must not simulate an unmute after fallback');
  assert.equal(f.classes.has('is-autoplay-blocked'), false);
  f.soundClick();
  assert.equal(f.video.muted, false); assert.equal(f.video.paused, false);
  assert.equal(f.video.dataset.autoplayMuted, undefined, 'an explicit sound tap releases the fallback');
  assert.equal(f.storage.get('mydancr.video-sound-muted.v1'), 'sound-on');
});

test('a browser blocking even muted autoplay retains a visible play fallback without repeated retries', async () => {
  const f = fixture(); f.setDenyMuted(true); await f.play();
  assert.deepEqual(f.attempts, [false, true]);
  assert.equal(f.video.paused, true); assert.equal(f.classes.has('is-autoplay-blocked'), true);
  f.slide.dataset.userPaused = 'true'; await f.play();
  assert.equal(f.attempts.length, 2, 'a manual pause is never undone');
});

test('profile autoplay uses inline muted fallback without the sound controller interrupting it', async () => {
  const f = fixture();
  Object.assign(f.context, { activeProfileTvViewerVideo: () => f.video, syncProfileTvSoundControl() {} });
  vm.runInContext(source('playProfileTvViewerVideo'), f.context);
  await f.context.playProfileTvViewerVideo(f.video);
  assert.deepEqual(f.attempts, [false, true]); assert.equal(f.video.paused, false);
  assert.equal(f.video.playsInline, true); assert.equal(f.video.attrs.has('webkit-playsinline'), true);
  f.video.pause(); f.video.dataset.userPaused = 'true';
  await f.context.playProfileTvViewerVideo(f.video);
  assert.equal(f.attempts.length, 2);
});

test('a stopped TV video starts within its click event while double-tap applause remains available', () => {
  const listeners = {}, timers = [], calls = [];
  let now = 1000, insideClick = false;
  const video = { dataset: {}, paused: true, readyState: 0,
    setAttribute() {}, addEventListener(type, fn) { listeners[type] = fn; } };
  const slide = { dataset: { videoId: 'clip' }, classList: { remove() {} }, removeAttribute() {} };
  const context = vm.createContext({
    homeTvLandingPreload: { takeVideo: () => video }, homeTvPlaybackVideoUrl: item => item.videoUrl,
    homeTvFeedCoveredByProfile: () => false, homeTvFeedMuted: true,
    Date: { now: () => now }, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    window: { clearTimeout() {}, setTimeout(fn) { timers.push(fn); return timers.length; } },
    watchVideoPosterPresentation() {}, trackDiscoveryVideo() {}, attachDeferredVideoSource() {}, syncHomeTvFeedSoundButtons() {},
    toggleHomeTvFeedPlayback(target) { calls.push({ insideClick }); target.paused = !target.paused; },
    applaudHomeTvFeedVideo() { calls.push('applaud'); },
  });
  vm.runInContext(source('createHomeTvFeedVideo'), context);
  context.createHomeTvFeedVideo({ id: 'clip', videoUrl: '/clip.mp4' }, 0, slide, 1);
  insideClick = true; listeners.click(); insideClick = false;
  assert.deepEqual(calls, [{ insideClick: true }]); assert.equal(timers.length, 0);
  now += 100; listeners.click();
  assert.deepEqual(calls, [{ insideClick: true }, 'applaud']);
  assert.equal(video.paused, false);
});
