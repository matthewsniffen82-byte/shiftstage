import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { serveDancerMedia } from '../src/lib/dancr/media-delivery.ts';

const id = '96000000-0000-4000-8000-000000000001';
const photoPath = 'owner/photo.jpg';
const row = {
  id, storage_path: 'owner/video.mp4',
  dancer_profiles: { id, disabled_at: null, app_users: { account_state: 'active' } },
};

function fixture({ holdQuery = 0 } = {}) {
  const queries = [], storage = [];
  const started = Promise.withResolvers(), held = Promise.withResolvers();
  const client = createClient('https://media.example.test', 'synthetic-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, options) => {
      queries.push({ url: String(url), signal: options.signal });
      if (queries.length === holdQuery) {
        started.resolve();
        // Also exercise a late response from a transport that ignored abort.
        await held.promise;
      }
      return Response.json([row]);
    } },
  });
  const deps = {
    publicClient: client, admin: client,
    storageUrl: 'https://media.example.test', serviceKey: 'synthetic-server-key',
    fetch: async (url, options) => {
      storage.push({ url, options });
      return new Response('video', { headers: { 'content-type': 'video/mp4' } });
    },
  };
  const get = (controller, kind = 'video') => serveDancerMedia(new Request(
    `https://app.example.test/api/media/dancer-${kind}?${kind === 'video' ? `id=${id}` : `path=${photoPath}`}`,
    { signal: controller.signal },
  ), kind, deps);
  return { queries, storage, started, held, get, deps };
}

test('a cancelled media request starts no database or Storage requests', async () => {
  const f = fixture(), controller = new AbortController();
  controller.abort();
  const response = await f.get(controller);
  await response.body?.cancel();
  assert.equal(f.queries.length, 0);
  assert.equal(f.storage.length, 0);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
});

for (const [label, kind, holdQuery, queryCount] of [
  ['video visibility', 'video', 1, 1],
  ['video object lookup', 'video', 2, 2],
  ['parallel photo visibility', 'photo', 1, 2],
]) test(`aborting during ${label} cancels queries and never starts a stale media download`, async () => {
  const f = fixture({ holdQuery }), controller = new AbortController();
  const pending = f.get(controller, kind);
  await f.started.promise;
  controller.abort();
  f.held.resolve();
  const response = await pending;
  await response.body?.cancel();
  assert.equal(f.storage.length, 0, 'a late permission response must not start Storage');
  assert.equal(f.queries.length, queryCount, 'obsolete requests stop at the current lookup');
  assert.ok(f.queries.every(query => query.signal?.aborted), 'the SDK receives cancellation');
});

test('cancelling a streamed response still stops the upstream download', async () => {
  const f = fixture(), controller = new AbortController();
  let cancelled = false;
  f.deps.fetch = async (_url, options) => {
    f.storage.push({ options });
    return new Response(new ReadableStream({
      pull(stream) { stream.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'video/mp4' } });
  };
  const response = await f.get(controller);
  const reader = response.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1, 2, 3]);
  await reader.cancel();
  assert.equal(cancelled, true);
  assert.equal(f.storage[0].options.signal.aborted, true);
});

test('aborting while Storage headers are pending disposes a late response', async () => {
  const f = fixture(), controller = new AbortController();
  const started = Promise.withResolvers(), held = Promise.withResolvers();
  let upstreamSignal, cancelled = false;
  f.deps.fetch = async (_url, options) => {
    upstreamSignal = options.signal;
    started.resolve();
    await held.promise;
    return new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'video/mp4' } });
  };
  const pending = f.get(controller);
  await started.promise;
  controller.abort();
  held.resolve();
  const response = await pending;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(response.status, 503);
  assert.equal(response.body, null);
});
