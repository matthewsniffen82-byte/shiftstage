import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createPerformanceReceiver, validatePerformanceReport } from '../src/lib/performance-report.ts';

const sample = { version: 1, release: 'a'.repeat(40), route: 'home', device: 'mobile', metrics: { lcpMs: 1250, cls: .02, tvRebuffers: 2 } };
const request = (body = sample, headers = {}) => new Request('https://app.example/api/public/performance', {
  method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('receiver logs only bounded numeric metrics and coarse categories, without extra fields', async () => {
  const logs = [], receive = createPerformanceReceiver(value => logs.push(value));
  const response = await receive(request({ ...sample, email: 'private@example.invalid', url: '/secret' }));
  assert.equal(response.status, 204);
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0]).sort(), ['event','version','sampleRate','release','route','device','metrics'].sort());
  assert.equal(logs[0].sampleRate, .01);
  assert.equal(validatePerformanceReport({ ...sample, device: ['mobile'] }), null);
  for (const invalid of [{ ...sample, route: '/dancers/somebody' }, { ...sample, release: 'bad\nvalue' }, { ...sample, metrics: { lcpMs: -1 } }, { ...sample, metrics: { lcpMs: Infinity } }, { ...sample, metrics: { unknown: 1 } }]) assert.equal(validatePerformanceReport(invalid), null);
  assert.equal((await receive(request(sample, { origin: 'https://elsewhere.example' }))).status, 403);
  assert.equal((await receive(request(sample, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await receive(request({ ...sample, junk: 'x'.repeat(2048) }))).status, 400);
  assert.equal(logs.length, 1);
});

test('logging has a bounded instance window and resumes after the window', async () => {
  let now = 0, count = 0;
  const receive = createPerformanceReceiver(() => count++, () => now);
  for (let i = 0; i < 120; i++) assert.equal((await receive(request())).status, 204);
  assert.equal((await receive(request())).status, 429);
  now = 60000;
  assert.equal((await receive(request())).status, 204);
  assert.equal(count, 121);
});

function browser({ sampleRate = 0, privacy = false } = {}) {
  const observers = [], events = new Map(), sends = [];
  const listen = { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) };
  const document = { ...listen, currentScript: { dataset: { release: sample.release } }, visibilityState: 'visible' };
  const context = { navigator: { globalPrivacyControl: privacy }, document, window: listen, URL, location: { href: 'https://app.example/?private=ignored' },
    Math: Object.assign(Object.create(Math), { random: () => sampleRate }), innerWidth: 390, performance: { now: () => 2500 },
    fetch: (url, options) => { sends.push({ url, options }); return Promise.resolve(); },
    PerformanceObserver: class {
      constructor(callback) { this.callback = callback; this.entries = []; observers.push(this); }
      observe(options) { this.type = options.type; }
      takeRecords() { return this.entries.splice(0); }
      disconnect() { this.disconnected = true; }
    },
  };
  vm.runInNewContext(readFileSync('public/mydancr-performance.js', 'utf8'), context);
  return { observers, events, sends, document };
}

test('sampled browser flushes once, drains buffered records, excludes preload waiting and sends no credentials', () => {
  const f = browser();
  f.observers.find(o => o.type === 'largest-contentful-paint').entries.push({ startTime: 1234 });
  const video = { matches: () => true, closest: () => ({}), paused: false };
  f.events.get('waiting')({ target: video });
  f.events.get('playing')({ target: video });
  f.events.get('waiting')({ target: video });
  const flush = f.events.get('pagehide');
  flush(); flush();
  assert.equal(f.sends.length, 1);
  const { options } = f.sends[0];
  assert.equal(options.credentials, 'omit');
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body).metrics, { cls: 0, lcpMs: 1234, tvFirstPlayMs: 2500, tvRebuffers: 1 });
  assert.ok(f.observers.every(o => o.disconnected));
  assert.equal(f.events.size, 0);
  assert.doesNotMatch(options.body, /private|ignored/);
});

test('unsampled visits and privacy opt-outs create no observers or requests', () => {
  for (const settings of [{ sampleRate: .5 }, { privacy: true }]) {
    const f = browser(settings);
    assert.equal(f.observers.length, 0); assert.equal(f.sends.length, 0);
  }
});
