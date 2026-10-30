import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const lifecycle = require('../public/video-autoplay-lifecycle.js');
const settle = () => new Promise(resolve => setImmediate(resolve));

class Events {
  listeners = new Map();
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(type, options = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, ...options }); }
}

function fixture() {
  const doc = new Events(), view = new Events(), video = new Events();
  doc.defaultView = view; doc.visibilityState = 'visible';
  Object.assign(video, { ownerDocument: doc, isConnected: true, paused: true, dataset: {}, attrs: new Map(),
    setAttribute(name, value) { this.attrs.set(name, value); } });
  let active = true, ready = false, gesture = false;
  const calls = [];
  const stop = lifecycle.mount(video, {
    isActive: () => active && video.dataset.userPaused !== 'true',
    play: () => {
      calls.push({ gesture });
      if (!ready && !gesture) return Promise.reject({ name: 'NotAllowedError' });
      video.paused = false;
      return Promise.resolve();
    },
  });
  return { video, doc, view, calls, stop, setReady(value) { ready = value; }, setActive(value) { active = value; },
    interact(type, target = null, trusted = true) { gesture = true; doc.emit(type, { target, isTrusted: trusted }); gesture = false; } };
}

test('a blocked initial player retries when Safari makes its media ready, without another tap', async () => {
  const f = fixture(); await settle();
  assert.equal(f.video.paused, true);
  f.setReady(true); f.video.emit('canplay'); await settle();
  assert.equal(f.video.paused, false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.video.attrs.has('autoplay'), true);
  assert.equal(f.video.attrs.has('playsinline'), true);
  assert.equal(f.video.attrs.has('webkit-playsinline'), true);
  f.video.emit('loadeddata'); await settle();
  assert.equal(f.calls.length, 2, 'readiness events do not restart a playing video');
  f.stop();
});

test('trusted interactions retry synchronously, while synthetic clicks and video touchend do not', async () => {
  const f = fixture(); await settle();
  f.interact('click', null, false);
  f.interact('touchend', { closest: () => ({}) });
  assert.equal(f.calls.length, 1);
  f.interact('touchend'); await settle();
  assert.equal(f.video.paused, false);
  assert.deepEqual(f.calls.at(-1), { gesture: true });
  f.stop();
});

test('hidden, detached, inactive and manually paused videos never restart on recovery events', async () => {
  for (const state of ['hidden', 'detached', 'inactive', 'manual']) {
    const f = fixture(); await settle(); f.setReady(true);
    if (state === 'hidden') f.doc.visibilityState = 'hidden';
    if (state === 'detached') f.video.isConnected = false;
    if (state === 'inactive') f.setActive(false);
    if (state === 'manual') f.video.dataset.userPaused = 'true';
    f.video.emit('canplay'); f.interact('click'); f.view.emit('pageshow'); await settle();
    assert.equal(f.calls.length, 1, state);
    assert.equal(f.video.paused, true, state);
    f.stop();
  }
});

test('page restoration recovers the selected video and cleanup removes every listener', async () => {
  const f = fixture(); await settle(); f.setReady(true);
  f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange');
  f.doc.visibilityState = 'visible'; f.view.emit('pageshow'); await settle();
  assert.equal(f.video.paused, false);
  f.stop(); f.video.paused = true;
  f.doc.emit('visibilitychange'); f.video.emit('canplay'); f.interact('click'); await settle();
  assert.equal(f.calls.length, 2);
  for (const target of [f.video, f.doc, f.view]) assert.ok([...target.listeners.values()].every(set => set.size === 0));
});

function tvFixture() {
  const source = readFileSync('app/tv/TvFeedClient.tsx', 'utf8');
  const start = source.indexOf('  const attemptVideoPlayback =');
  const end = source.indexOf('  const primeNextVideo', start);
  const code = ts.transpileModule(source.slice(start, end) + '\nglobalThis.play = attemptVideoPlayback;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const attempts = [], soundStates = [];
  const video = { dataset: {}, muted: false, attrs: new Map(), paused: true,
    setAttribute(name, value) { this.attrs.set(name, value); },
    play() { attempts.push(this.muted); if (!this.muted) return Promise.reject(new DOMException('Gesture required', 'NotAllowedError')); this.paused = false; return Promise.resolve(); } };
  const context = vm.createContext({ useCallback: fn => fn, DOMException,
    activeVideoIdRef: { current: 'active' }, manuallyPausedVideoId: { current: '' }, mutedRef: { current: false },
    document: { visibilityState: 'visible' }, setPlaybackMuted: value => soundStates.push(value), setAutoplayBlockedVideoId() {} });
  vm.runInContext(code, context);
  return { video, attempts, soundStates, context, play: () => context.play('active', video) };
}

test('TV readiness and buffer updates retain the Safari-muted fallback without changing saved sound preference', async () => {
  const f = tvFixture(); await f.play();
  assert.deepEqual(f.attempts, [false, true]);
  assert.equal(f.video.dataset.autoplayMuted, 'true');
  f.video.paused = true; await f.play();
  assert.deepEqual(f.attempts, [false, true, true]);
  assert.equal(f.context.mutedRef.current, false, 'the saved sound choice remains intact');
  assert.equal(f.soundStates.at(-1), true, 'the sound control represents actual muted playback');
});

test('an in-flight autoplay rejection cannot restart TV after a manual pause or navigation', async () => {
  for (const state of ['manual', 'hidden', 'inactive']) {
    const f = tvFixture(); let reject;
    f.video.play = () => { f.attempts.push(f.video.muted); return new Promise((_, fail) => { reject = fail; }); };
    const request = f.play();
    if (state === 'manual') f.context.manuallyPausedVideoId.current = 'active';
    if (state === 'hidden') f.context.document.visibilityState = 'hidden';
    if (state === 'inactive') f.context.activeVideoIdRef.current = 'other';
    reject(new DOMException('Gesture required', 'NotAllowedError')); await request;
    assert.equal(f.attempts.length, 1, state);
  }
});
