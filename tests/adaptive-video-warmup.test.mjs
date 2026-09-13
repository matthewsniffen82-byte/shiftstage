import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../public/adaptive-video.mjs', import.meta.url), 'utf8');
const injected = source.replace("import(/* webpackIgnore: true */ '/hls-engine.js?v=1.7.3')", 'Promise.resolve({default: FakeHls})');
assert.notEqual(injected, source);
const code = ts.transpileModule(injected, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(setImmediate);
function fixture(t) {
  const engines = [], videos = [];
  class FakeHls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', FRAG_BUFFERED: 'buffered' };
    static isSupported = () => true;
    constructor(config) { this.config = config; this.handlers = new Map(); this.starts = []; this.stops = 0; engines.push(this); }
    on(name, callback) { this.handlers.set(name, callback); }
    once(name, callback) { this.on(name, callback); }
    emit(name) { this.handlers.get(name)?.(name, {}); }
    loadSource() {}
    attachMedia(video) { this.video = video; video.src = 'blob:fixture'; }
    startLoad(position) { this.starts.push(position); }
    stopLoad() { this.stops++; }
    destroy() { this.destroyed = true; }
    buffer() { this.video.readyState = 4; this.video.buffered.length = 1; this.emit('buffered'); }
  }
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const exports = {};
  vm.runInNewContext(code, { exports, FakeHls, document, navigator: { userAgent: 'Chrome Android' }, Event, setTimeout, clearTimeout });
  t.after(() => videos.forEach(exports.releaseAdaptiveVideo));
  async function create() {
    const video = Object.assign(new EventTarget(), { isConnected: true, paused: true, autoplay: false, currentTime: 0, readyState: 0, buffered: { length: 0 }, src: '',
      canPlayType: () => '', hasAttribute(name) { return name === 'src' && Boolean(this.src); }, removeAttribute() { this.src = ''; }, load() {},
      pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
      async play() { this.paused = false; this.dispatchEvent(new Event('play')); },
    });
    videos.push(video);
    await exports.attachAdaptiveVideo(video, '/manifest-' + videos.length, '/original');
    const engine = engines.at(-1);
    engine.emit('manifest');
    return { video, engine };
  }
  return { ...exports, create, document };
}

test('paused neighbors serialize one-segment warmups and promotion never restarts an in-flight segment', async t => {
  const f = fixture(t), first = await f.create(), second = await f.create();
  const a = f.warmAdaptiveVideo(first.video), b = f.warmAdaptiveVideo(second.video);
  await tick();
  assert.deepEqual(first.engine.starts, [0]); assert.deepEqual(second.engine.starts, []);
  assert.equal(first.engine.config.maxMaxBufferLength, 2);
  assert.ok(first.video.paused && second.video.paused);
  first.engine.buffer(); await a; await tick();
  assert.equal(first.engine.stops, 1); assert.deepEqual(second.engine.starts, [0]);
  await second.video.play(); await b;
  assert.deepEqual(second.engine.starts, [0], 'do not abort and refetch the almost-finished segment when the card becomes active');
  assert.equal(second.engine.config.maxMaxBufferLength, 12);
  await first.video.play();
  assert.deepEqual(first.engine.starts, [0, -1], 'a fully warmed suspended stream resumes from its existing buffer');
});

test('a canceled queued neighbor never starts media downloads after priorities change', async t => {
  const f = fixture(t), first = await f.create(), second = await f.create();
  const a = f.warmAdaptiveVideo(first.video), b = f.warmAdaptiveVideo(second.video);
  await tick(); f.suspendAdaptiveVideo(second.video); f.releaseAdaptiveVideo(first.video);
  await Promise.all([a, b]);
  assert.deepEqual(second.engine.starts, []);
  const retry = f.warmAdaptiveVideo(second.video); await tick();
  assert.deepEqual(second.engine.starts, [0]);
  second.engine.buffer(); await retry;
});

test('MSE appends notify buffer policy and hidden pages do not warm new neighbors', async t => {
  const f = fixture(t), { video, engine } = await f.create();
  let changes = 0; video.addEventListener('mydancrvideobufferchange', () => changes++);
  engine.buffer(); assert.equal(changes, 1);
  f.document.visibilityState = 'hidden';
  await f.warmAdaptiveVideo(video); assert.deepEqual(engine.starts, []);
});
