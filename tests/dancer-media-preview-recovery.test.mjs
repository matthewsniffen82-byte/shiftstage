import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createMediaStatusCoordinator } from '../src/lib/media-status-coordinator.ts';

const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

test('failed thumbnails coalesce refreshes, respect visibility, and never share the cooldown across accounts', () => {
  let owner = 'first', now = 1000;
  const events = [], document = { visibilityState: 'visible' }, exports = {};
  vm.runInNewContext(compile('app/dashboard/dancer-media-status.ts'), {
    exports, document, Event, Date: { now: () => now }, window: { dispatchEvent: event => events.push(event.type) },
    require: name => name.endsWith('media-status-coordinator') ? { createMediaStatusCoordinator: () => () => {} }
      : { readSession: () => ({ account: { id: owner } }) },
  });
  const refresh = exports.refreshDancerPhotoPreviews;
  refresh(); refresh(); refresh();
  assert.deepEqual(events, ['mydancr:dancer-media-changed']);
  now += 15_000; refresh(); assert.equal(events.length, 2);
  owner = 'second'; refresh(); assert.equal(events.length, 3);
  document.visibilityState = 'hidden'; now += 15_000; refresh(); assert.equal(events.length, 3);
  document.visibilityState = 'visible'; owner = ''; refresh(); assert.equal(events.length, 3);
});

test('a preview failure renews unchanged media and still recovers if the status endpoint is unavailable', async () => {
  let force, requests = 0, unavailable = false;
  const subscribe = createMediaStatusCoordinator({
    read: async () => { if (unavailable) throw Error('Status timeout'); return { profile: 'unchanged', videos: 'same', batch: 'same' }; },
    owner: () => 'owner', visible: () => true, schedule: () => 1, cancel() {},
    listen: callback => { force = callback; return () => { force = null; }; },
  });
  const stop = subscribe('profile', () => { requests++; });
  await settle(); assert.equal(requests, 1);
  force(); await settle(); assert.equal(requests, 2);
  unavailable = true; force(); await settle(); assert.equal(requests, 3);
  stop(); assert.equal(force, null);
});

function videosFixture(request) {
  const state = [], effects = [], timers = new Map(), events = new Map(), requests = [], exports = {};
  let cursor = 0, timerId = 0;
  const eventHost = {
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name),
  };
  const document = { visibilityState: 'visible', ...eventHost };
  const deps = {
    useState(initial) { const i = cursor++; state[i] = initial; return [initial, value => { state[i] = value; }]; },
    useEffect: callback => effects.push(callback), readSession: () => ({ accessToken: 'test-only' }),
    requestDancerTvVideosJson: options => { requests.push(options); return request(requests.length); },
    DANCER_PROFILE_VIDEOS_CHANGED_EVENT: 'videos-changed',
  };
  vm.runInNewContext(compile('app/dashboard/useDancerProfileVideos.ts'), {
    exports, document, AbortController, Error, require: () => deps, window: {
      ...eventHost, clearTimeout: id => timers.delete(id),
      setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    },
  });
  exports.useDancerProfileVideos('profile'); const cleanup = effects[0]();
  return { state, timers, events, document, requests, cleanup,
    async tick() { const [id, job] = timers.entries().next().value; timers.delete(id); job.callback(); await settle(); },
  };
}

test('a timed-out video list retries and restores the saved video instead of staying empty', async () => {
  const f = videosFixture(async attempt => {
    if (attempt === 1) throw Object.assign(Error('Loading took too long.'), { status: 408 });
    return { videos: [{ id: 'saved', status: 'approved' }] };
  });
  await settle(); assert.match(f.state[1], /too long/); assert.equal(f.timers.size, 1);
  await f.tick(); assert.equal(f.state[1], ''); assert.equal(f.state[2][0].id, 'saved');
  assert.equal(f.state[0], false); assert.equal(f.timers.size, 0);
  f.cleanup(); assert.equal(f.events.size, 0);
});

test('video retries stop after three attempts and resume on reconnect without overlapping requests', async () => {
  let recover = false, resolve;
  const f = videosFixture(async () => {
    if (!recover) throw Object.assign(Error('Offline'), { status: 408 });
    return new Promise(done => { resolve = done; });
  });
  await settle();
  for (const delay of [8000, 16000, 30000]) {
    assert.equal([...f.timers.values()][0].delay, delay); await f.tick();
  }
  assert.equal(f.requests.length, 4); assert.equal(f.timers.size, 0);
  f.document.visibilityState = 'hidden'; f.events.get('focus')(); assert.equal(f.requests.length, 4);
  recover = true; f.document.visibilityState = 'visible';
  f.events.get('online')(); f.events.get('focus')(); assert.equal(f.requests.length, 5);
  resolve({ videos: [{ id: 'restored', status: 'approved' }] }); await settle();
  assert.equal(f.state[1], ''); assert.equal(f.state[2][0].id, 'restored');
  f.cleanup(); assert.equal(f.timers.size, 0); assert.equal(f.events.size, 0);
});

test('authorization failures are not automatically retried, and unmount cancels pending retry work', async () => {
  for (const status of [401, 403, 408]) {
    const f = videosFixture(async () => { throw Object.assign(Error('Unavailable'), { status }); });
    await settle(); assert.equal(f.timers.size, status === 408 ? 1 : 0);
    f.cleanup(); assert.equal(f.timers.size, 0); assert.equal(f.events.size, 0);
  }
});
