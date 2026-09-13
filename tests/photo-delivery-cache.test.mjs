import assert from 'node:assert/strict';
import test from 'node:test';
import { importMediaModule } from './helpers/server-media-module.mjs';
const { serveDancerMedia } = await importMediaModule('media-delivery.ts');
const { PhotoDeliveryCache, MAX_CACHED_PHOTO_BYTES } = await importMediaModule('photo-delivery-cache.ts');
const { mediaPreviewToken } = await importMediaModule('media-delivery-url.ts');
process.env.DANCR_ACCOUNT_RECOVERY_SECRET = 'synthetic-photo-cache-secret';
const path = 'owner/photo.r320-480.m900x1200.f50x50.jpg.w320.webp';
const url = `https://app.example/api/media/dancer-photo?path=${path}`;
const bytes = new Uint8Array([1, 2, 3]);
const headers = new Headers({ 'content-type': 'image/webp' });
const drain = async response => { const data = new Uint8Array(await response.arrayBuffer()); return { response, data }; };

function fixture() {
  const state = { visible: true, error: false, reads: 0, downloads: 0 };
  const client = { from(table) {
    const query = new Proxy({ then(resolve) {
      state.reads++;
      resolve({ data: state.visible && table === 'dancer_photos' ? { storage_path: path, dancer_profiles: { disabled_at: null, app_users: { account_state: 'active' } } } : null, error: state.error ? new Error('private diagnostic') : null });
    } }, { get: (target, name) => target[name] || (() => query) });
    return query;
  } };
  const deps = { publicClient: client, admin: client, storageUrl: 'https://storage.example', serviceKey: 'synthetic-key', photoCache: new PhotoDeliveryCache(),
    fetch: async (_url, options) => {
      state.downloads++;
      return new Response(options.method === 'HEAD' ? null : bytes, { status: options.headers.range ? 206 : 200, headers: { 'content-type': 'image/webp', 'content-length': '3', 'x-provider-private': 'hidden' } });
    },
  };
  return { state, deps, get: (options = {}, requestUrl = url) => serveDancerMedia(new Request(requestUrl, options), 'photo', deps) };
}

test('repeat photos skip Storage but recheck current visibility and keep browsers from caching', async () => {
  const f = fixture();
  for (let n = 0; n < 2; n++) {
    const { response, data } = await drain(await f.get());
    assert.deepEqual(data, bytes);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('x-provider-private'), null);
  }
  assert.equal(f.state.downloads, 1);
  assert.equal(f.state.reads, 4);
  f.state.visible = false;
  assert.equal((await f.get()).status, 404, 'cached bytes cannot outlive public permission');
  f.state.visible = true; f.state.error = true;
  assert.equal((await f.get()).status, 503, 'an authorization failure cannot fall back to cached bytes');
  assert.equal(f.state.downloads, 1);
  assert.equal(f.state.reads, 8);
});

test('photo sizes and storage origins have separate cache entries', async () => {
  const f = fixture();
  for (const requestUrl of [url, url + '&width=96', url + '&width=160', url]) await drain(await f.get({}, requestUrl));
  assert.equal(f.state.downloads, 3);
  f.deps.storageUrl = 'https://another-storage.example';
  await drain(await f.get());
  assert.equal(f.state.downloads, 4);
});

test('preview and range requests neither use nor replace public full-photo entries', async () => {
  const f = fixture();
  await drain(await f.get());
  const previewUrl = url + '&preview=' + mediaPreviewToken('photo:' + path);
  await drain(await f.get({}, previewUrl));
  await drain(await f.get({}, previewUrl));
  assert.equal((await drain(await f.get({ headers: { range: 'bytes=0-2' } }))).response.status, 206);
  assert.equal((await drain(await f.get())).response.status, 200);
  assert.equal(f.state.downloads, 4);
});

test('HEAD reuses complete cached metadata but an empty HEAD never warms the cache', async () => {
  const f = fixture();
  assert.equal((await drain(await f.get({ method: 'HEAD' }))).data.byteLength, 0);
  assert.deepEqual((await drain(await f.get())).data, bytes);
  assert.equal((await drain(await f.get({ method: 'HEAD' }))).data.byteLength, 0);
  assert.equal(f.state.downloads, 2);
});

test('oversized photos still stream without entering the small-photo cache', async () => {
  const f = fixture();
  f.deps.fetch = async () => { f.state.downloads++; return new Response(new Uint8Array(MAX_CACHED_PHOTO_BYTES + 1), { headers }); };
  for (let n = 0; n < 2; n++) assert.equal((await drain(await f.get())).data.byteLength, MAX_CACHED_PHOTO_BYTES + 1);
  assert.equal(f.state.downloads, 2);
});

test('cancelled or failed streams never retain partial photos', async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    const normalFetch = f.deps.fetch;
    let pulls = 0;
    f.deps.fetch = async () => new Response(new ReadableStream({ pull(controller) {
      if (fail && pulls++) controller.error(new Error('interrupted photo'));
      else controller.enqueue(bytes);
    } }), { headers });
    const response = await f.get();
    if (fail) await assert.rejects(response.arrayBuffer());
    else { const reader = response.body.getReader(); await reader.read(); await reader.cancel(); }
    f.deps.fetch = normalFetch;
    assert.deepEqual((await drain(await f.get())).data, bytes);
    assert.equal(f.state.downloads, 1, 'must fetch a complete photo after interruption');
  }
});

test('cancellation and invalid variants cannot use an otherwise warm photo cache', async () => {
  const f = fixture(); await drain(await f.get());
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.get({ signal: controller.signal })).status, 503);
  assert.equal((await f.get({}, url.replace('.w320.webp', '.w640.webp'))).status, 404);
  assert.equal(f.state.downloads, 1);
});

test('photo cache has fixed expiry, LRU eviction and byte/entry ceilings', () => {
  const cache = new PhotoDeliveryCache();
  cache.set('expiring', bytes, headers, 0);
  assert.ok(cache.get('expiring', 119999));
  assert.equal(cache.get('expiring', 120000), null, 'reads cannot extend retention');
  for (let i = 0; i < 128; i++) cache.set(String(i), bytes, headers, 0);
  cache.get('0', 1);
  cache.set('next', bytes, headers, 1);
  assert.equal(cache.get('1', 1), null);
  assert.ok(cache.get('0', 1));
  const bounded = new PhotoDeliveryCache();
  for (let i = 0; i < 17; i++) bounded.set(String(i), new Uint8Array(MAX_CACHED_PHOTO_BYTES), headers, 0);
  assert.equal(bounded.get('0', 1), null);
  assert.ok(bounded.get('16', 1));
  bounded.set('too-large', new Uint8Array(MAX_CACHED_PHOTO_BYTES + 1), headers, 0);
  assert.equal(bounded.get('too-large', 1), null);
});
