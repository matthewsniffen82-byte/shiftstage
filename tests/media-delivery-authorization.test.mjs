import assert from 'node:assert/strict';
import test from 'node:test';
import { importMediaModule } from './helpers/server-media-module.mjs';

const { serveDancerMedia } = await importMediaModule('media-delivery.ts');
const id = '96000000-0000-4000-8000-000000000002';
const permitted = { data: { id }, error: null };
const object = { data: {
  storage_path: 'synthetic-owner/approved.mp4',
  dancer_profiles: { disabled_at: null, app_users: { account_state: 'active' } },
}, error: null };

function fixture() {
  const reads = [], downloads = [];
  const visibility = Promise.withResolvers(), lookup = Promise.withResolvers();
  const client = (label, pending) => ({ from(table) {
    const calls = [];
    const query = new Proxy({ then(resolve, reject) {
      reads.push({ label, table, calls });
      return pending.promise.then(resolve, reject);
    } }, { get: (target, name) => target[name] || ((...args) => { calls.push([name, ...args]); return query; }) });
    return query;
  } });
  const controller = new AbortController();
  const response = serveDancerMedia(new Request(`https://app.example.test/api/media/dancer-video?id=${id}`, {
    signal: controller.signal, headers: { range: 'bytes=0-2' },
  }), 'video', {
    publicClient: client('anonymous RLS', visibility), admin: client('private object', lookup),
    storageUrl: 'https://storage.example.test', serviceKey: 'synthetic-server-key',
    fetch: async (url, options) => {
      downloads.push({ url: String(url), options });
      return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: {
        'content-type': 'video/mp4', 'content-range': 'bytes 0-2/30',
      } });
    },
  });
  return { reads, downloads, visibility, lookup, controller, response };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const first of ['visibility', 'lookup']) {
  test(`video authorization reads run together and await both when ${first} finishes first`, async () => {
    const f = fixture();
    await settle();
    assert.deepEqual(f.reads.map(read => read.label), ['anonymous RLS', 'private object']);
    assert.equal(f.downloads.length, 0);
    f[first].resolve(first === 'visibility' ? permitted : object);
    await settle();
    assert.equal(f.downloads.length, 0, 'one successful check cannot authorize Storage');
    f[first === 'visibility' ? 'lookup' : 'visibility'].resolve(first === 'visibility' ? object : permitted);
    const response = await f.response;
    assert.equal(response.status, 206);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
    assert.equal(f.downloads.length, 1);
    assert.equal(f.downloads[0].options.headers.range, 'bytes=0-2');
    assert.match(response.headers.get('cache-control'), /private, no-store/);
  });
}

for (const [label, visibleResult, objectResult, expected] of [
  ['unpublished video', { data: null, error: null }, object, 404],
  ['disabled profile', permitted, { data: { ...object.data, dancer_profiles: { ...object.data.dancer_profiles, disabled_at: '2026-09-13' } }, error: null }, 404],
  ['disabled account', permitted, { data: { ...object.data, dancer_profiles: { disabled_at: null, app_users: { account_state: 'disabled' } } }, error: null }, 404],
  ['missing object', permitted, { data: null, error: null }, 404],
  ['visibility failure', { data: null, error: new Error('private diagnostic') }, object, 503],
  ['object lookup failure', permitted, { data: null, error: new Error('private diagnostic') }, 503],
]) {
  test(`parallel reads fail closed for ${label}`, async () => {
    const f = fixture();
    f.lookup.resolve(objectResult);
    f.visibility.resolve(visibleResult);
    const response = await f.response;
    assert.equal(response.status, expected);
    assert.equal(await response.text(), '');
    assert.equal(f.downloads.length, 0);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  });
}

test('cancellation between parallel completions prevents a late video download', async () => {
  const f = fixture();
  f.lookup.resolve(object);
  await settle();
  f.controller.abort();
  f.visibility.resolve(permitted);
  assert.equal((await f.response).status, 503);
  assert.equal(f.downloads.length, 0);
  assert.ok(f.reads.every(read => read.calls.find(([name]) => name === 'abortSignal')[1].aborted));
});
