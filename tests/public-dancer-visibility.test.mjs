import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { publicDancerVisibility } from '../src/lib/dancr/public-dancer-visibility.ts';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const request = ids => new Request(`https://example.test/api/public/dancers/visibility?ids=${ids}`);
function client(result) {
  const calls = [];
  const query = new Proxy({}, { get(_target, name) {
    if (name === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    return (...args) => { calls.push([name, ...args]); return query; };
  } });
  return { client: query, calls };
}
test('public visibility returns only public IDs and never caches visibility decisions', async () => {
  const f = client({ data: [{ id }], error: null });
  const response = await publicDancerVisibility(request([id, other, id]), f.client);
  assert.deepEqual(await response.json(), { ok: true, visibleIds: [id] });
  assert.deepEqual(f.calls.slice(0, 4), [['from', 'dancer_profiles'], ['select', 'id'], ['in', 'id', [id, other]], ['eq', 'is_public', true]]);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
});
test('invalid and oversized visibility lists never query the database', async () => {
  for (const value of ['', 'not-a-uuid', `${id},`, Array(201).fill(id)]) {
    const f = client({ data: [], error: null });
    assert.equal((await publicDancerVisibility(request(value), f.client)).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
test('database failures cannot be mistaken for permission to display content', async () => {
  const f = client({ data: null, error: { message: 'private database diagnostic' } });
  const response = await publicDancerVisibility(request(id), f.client);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false });
});

// Exercise the shipped browser script with deterministic network and timers.
// The media source and DOM node survive hide/restore; no copies are republished.
const browserSource = readFileSync(new URL('../public/dancer-content-visibility.js', import.meta.url), 'utf8');
function browserFixture() {
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options?.detail; } }
  const video = { paused: false, src: '/api/media/dancer-video?id=saved',
    pause() { this.paused = true; }, load() {}, querySelectorAll() { return []; },
    hasAttribute(name) { return name === 'src' && Boolean(this.src); },
    getAttribute() { return this.src; }, removeAttribute() { this.src = null; }, setAttribute(_name, value) { this.src = value; },
  };
  const card = { dataset: { publicDancerId: id }, hidden: false,
    hasAttribute(name) { return name === 'data-public-visibility-hidden' && this.hidden; },
    setAttribute() { this.hidden = true; }, removeAttribute() { this.hidden = false; },
    querySelectorAll() { return [video]; },
  };
  let cards = [card];
  let mutationCallback;
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible', head: { appendChild() {} }, body: {},
    createElement: () => ({}), querySelectorAll: () => cards,
  });
  let tick = 0;
  const timers = new Map();
  const window = Object.assign(new EventTarget(), {
    location: { reloads: 0, reload() { this.reloads += 1; } },
    setTimeout(callback, delay) { timers.set(++tick, { callback, delay }); return tick; },
    clearTimeout(key) { timers.delete(key); },
  });
  const requests = [];
  let fetchResponse = async () => Response.json({ ok: true, visibleIds: [id] });
  vm.runInNewContext(browserSource, { document, window, CustomEvent, AbortController,
    localStorage: { setItem() {} }, MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} },
    fetch: (...args) => { requests.push(args); return fetchResponse(...args); },
  });
  async function runCheck() {
    const [key, value] = [...timers].find(([, value]) => value.delay !== 4500) || [];
    assert.ok(value, 'a visibility check is scheduled');
    timers.delete(key);
    await value.callback();
  }
  return { card, video, document, window, requests, runCheck,
    removeCard: () => { cards = []; }, mutate: () => mutationCallback(),
    respond: callback => { fetchResponse = callback; },
    save: isPublic => window.dispatchEvent(new CustomEvent('mydancr:dancer-visibility-saved', { detail: { dancerId: id, isPublic } })),
  };
}
test('an open card and playing video disappear; restoration loads fresh content', async () => {
  const f = browserFixture();
  await f.runCheck();
  assert.equal(f.card.hidden, false);
  f.respond(async () => Response.json({ ok: true, visibleIds: [] }));
  await f.runCheck();
  assert.equal(f.card.hidden, true);
  assert.equal(f.video.paused, true);
  assert.equal(f.video.src, null);
  f.respond(async () => Response.json({ ok: true, visibleIds: [id] }));
  await f.runCheck();
  assert.equal(f.card.hidden, true, 'old content stays hidden until the fresh page loads');
  assert.equal(f.window.location.reloads, 1);
  assert.ok(f.requests.every(([, options]) => options.cache === 'no-store' && options.credentials === 'omit'));
});
test('a completed incognito toggle wins against an older public response', async () => {
  const f = browserFixture();
  const deferred = Promise.withResolvers();
  f.respond(() => deferred.promise);
  const check = f.runCheck();
  f.save(false);
  assert.equal(f.card.hidden, true);
  deferred.resolve(Response.json({ ok: true, visibleIds: [id] }));
  await check;
  assert.equal(f.card.hidden, true);
  assert.equal(f.requests[0][1].signal.aborted, true);
});
test('a restore notification needs a fresh public read; failed reads keep content hidden', async () => {
  const f = browserFixture();
  f.save(false);
  f.save(true);
  assert.equal(f.card.hidden, true);
  f.respond(async () => { throw new Error('offline'); });
  await f.runCheck();
  assert.equal(f.card.hidden, true);
  f.respond(async () => Response.json({ ok: true, visibleIds: [id] }));
  await f.runCheck();
  assert.equal(f.window.location.reloads, 1);
});
test('returning from a background tab checks visibility before restoring content', async () => {
  const f = browserFixture();
  await f.runCheck();
  f.document.visibilityState = 'hidden';
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.card.hidden, true);
  f.document.visibilityState = 'visible';
  f.document.dispatchEvent(new Event('visibilitychange'));
  f.mutate();
  assert.equal(f.card.hidden, true, 'a DOM update cannot expose the background snapshot');
  f.respond(async () => Response.json({ ok: true, visibleIds: [] }));
  await f.runCheck();
  assert.equal(f.card.hidden, true);
});
test('a feed can remove a hidden card without losing the restoration check', async () => {
  const f = browserFixture();
  f.respond(async () => Response.json({ ok: true, visibleIds: [] }));
  await f.runCheck();
  f.removeCard();
  f.respond(async () => Response.json({ ok: true, visibleIds: [id] }));
  await f.runCheck();
  assert.equal(f.window.location.reloads, 1);
});
test('a temporary network failure recovers without reloading the page', async () => {
  const f = browserFixture();
  await f.runCheck();
  f.respond(async () => { throw new Error('offline'); });
  await f.runCheck();
  assert.equal(f.card.hidden, true);
  f.respond(async () => Response.json({ ok: true, visibleIds: [id] }));
  await f.runCheck();
  assert.equal(f.card.hidden, false);
  assert.equal(f.video.src, '/api/media/dancer-video?id=saved');
  assert.equal(f.window.location.reloads, 0);
});
