import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { id, loadNfcModule } from './helpers/internal-nfc-fixture.mjs';

const tap = { id: id(40), encrypted: 'a'.repeat(32), mac: 'b'.repeat(16) };
const grid = '/internal/club/' + id(3);
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({ proof = tap, visible = true, reply = () => Response.json({ ok: true, href: grid }) } = {}) {
  const document = new EventTarget();
  document.visibilityState = visible ? 'visible' : 'hidden';
  const requests = [], navigation = [], history = [], state = [];
  let index, mount;
  const { default: Entry } = loadNfcModule('app/internal/InternalTapEntry.tsx', {
    react: {
      useState(initial) {
        const slot = index++;
        return [state[slot] ?? initial, value => { state[slot] = value; }];
      },
      useEffect(callback) { mount = callback; },
    },
  }, {
    document, queueMicrotask, AbortSignal,
    window: {
      location: { pathname: '/internal/tap/' + proof.id, replace: href => navigation.push(href) },
      history: { replaceState: (_state, _title, url) => history.push(url) },
    },
    fetch: async (url, options) => { requests.push({ url, options }); return reply(); },
  });
  function render() { index = 0; return renderToStaticMarkup(Entry(proof)); }
  render();
  return { document, render, mount: () => mount(), requests, navigation, history };
}

test('a visible tap opens the correct grid automatically and consumes its proof exactly once across effect replay', async () => {
  const f = fixture();
  assert.equal(f.render(), '', 'a valid tap opens without an intermediate screen');
  f.mount()();
  const cleanup = f.mount();
  f.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.requests.length, 1);
  const { url, options } = f.requests[0];
  assert.equal(url, '/api/internal-tap/' + tap.id);
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.referrerPolicy, 'origin');
  assert.deepEqual(JSON.parse(options.body), { e: tap.encrypted, c: tap.mac });
  assert.ok(f.history.every(path => path === '/internal/tap/' + tap.id));
  assert.deepEqual(f.navigation, [grid]);
  assert.equal(f.render(), '');
  cleanup();
});

test('a hidden tap waits for visibility and a staged sticker shows its verification result', async () => {
  const f = fixture({ visible: false, reply: () => Response.json({ ok: true, tested: true }) });
  const cleanup = f.mount();
  await settle();
  assert.equal(f.requests.length, 0);
  f.document.visibilityState = 'visible';
  f.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(f.requests.length, 1);
  assert.match(f.render(), /Sticker verified/);
  assert.deepEqual(f.navigation, []);
  cleanup();
});

test('missing proof, rejected taps and unexpected destinations cannot open the grid', async () => {
  const missing = fixture({ proof: { ...tap, mac: '' } });
  missing.mount();
  await settle();
  assert.equal(missing.requests.length, 0);
  assert.match(missing.render(), /role="alert"/);
  for (const response of [Response.json({ ok: false, error: 'Tap the sticker again.' }, { status: 403 }),
    Response.json({ ok: true, href: 'https://elsewhere.invalid/' })]) {
    const f = fixture({ reply: () => response });
    const cleanup = f.mount();
    await settle();
    assert.match(f.render(), /role="alert"/);
    assert.deepEqual(f.navigation, []);
    cleanup();
  }
});

test('leaving the entry before a verification response arrives prevents a stale redirect', async () => {
  let finish;
  const f = fixture({ reply: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = f.mount();
  await settle();
  cleanup();
  finish(Response.json({ ok: true, href: grid }));
  await settle();
  assert.deepEqual(f.navigation, []);
});
