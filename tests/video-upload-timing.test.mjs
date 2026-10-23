import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createVideoUploadTiming, parseVideoUploadTiming } from '../src/lib/dancr/video-upload-timing.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

const input = { queueMs: 25, metadataMs: 50, reservationMs: 100, transferMs: 15000, parallelLimit: 2, transport: 'resumable', resumed: false };
test('upload timings separate queue, local preparation, reservation, and transfer without adding work', async () => {
  let now = 100;
  const timer = createVideoUploadTiming(25, 2, () => now);
  assert.equal(await timer.measure('metadataMs', async () => { now += 50; return 'metadata'; }), 'metadata');
  await timer.measure('reservationMs', async () => { now += 100; });
  await timer.measure('transferMs', async () => { now += 15000; });
  assert.deepEqual(timer.report({ transport: 'resumable', resumed: false }), input);
  assert.equal(createVideoUploadTiming(0, 1).report().transport, 'existing');
});
test('timing preserves cancellation and operation failures', async () => {
  const timer = createVideoUploadTiming(0, 1, () => 100);
  const failure = new DOMException('Canceled', 'AbortError');
  await assert.rejects(timer.measure('transferMs', async () => { throw failure; }), error => error === failure);
  assert.equal(timer.report().transferMs, 0);
});
test('optional diagnostics accept only bounded numbers and known values', () => {
  for (const field of ['queueMs', 'metadataMs', 'reservationMs', 'transferMs']) {
    for (const value of [-1, NaN, Infinity, 86_400_001, '100', null]) assert.equal(parseVideoUploadTiming({ ...input, [field]: value }), null);
  }
  for (const value of [null, [], {}, { ...input, parallelLimit: 6 }, { ...input, parallelLimit: 1.5 },
    { ...input, transport: ['resumable'] }, { ...input, transport: 'private-url' }, { ...input, resumed: 'yes' }]) {
    assert.equal(parseVideoUploadTiming(value), null);
  }
  assert.deepEqual(parseVideoUploadTiming({ ...input, token: 'secret', filename: 'private.mov', url: 'private', metadataMs: 50.2 }), input);
});

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const routeSource = readFileSync(new URL('../app/api/dancer/tv/videos/[id]/route.ts', import.meta.url), 'utf8');
function routeFixture({ authenticated = true, accepted = false } = {}) {
  const exports = {}, logs = [], deferred = [];
  let submissions = 0;
  const dependencies = {
    'next/server': { NextResponse: { json: Response.json }, after: callback => deferred.push(callback) },
    '@/src/lib/api': { apiError: () => Response.json({ error: 'Denied' }, { status: 400 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject },
    '@/src/lib/dancr/video-upload-timing': { parseVideoUploadTiming },
    '@/src/lib/dancr/tv': { submitMyDancrTvUpload: async (_client, owner, videoId) => {
      assert.equal(owner, 'owner'); assert.equal(videoId, id); submissions++;
      return { id, status: 'moderating', file_size_bytes: 1024, submissionAlreadyAccepted: accepted };
    } },
    '@/src/lib/dancr/media-request-rate-limit': { DancerMediaRateLimitError: class extends Error {}, enforceDancerMediaRequestRateLimit: async () => {} },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => { if (!authenticated) throw new Error('Denied'); return { user: { id: 'owner' } }; } },
    '@/src/lib/security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
    '@/src/lib/dancr/video-worker-dispatch': { dispatchVideoModeration: async () => {} },
  };
  vm.runInNewContext(ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, console: { info: message => logs.push(JSON.parse(message)), error() {} },
      require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { logs, deferred, get submissions() { return submissions; }, async submit(uploadTiming) {
    return exports.PATCH(new Request('https://example.invalid', { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit', uploadTiming }) }), { params: Promise.resolve({ id }) });
  } };
}
test('authenticated submission records sanitized timings without waiting for the worker', async () => {
  const f = routeFixture();
  assert.equal((await f.submit({ ...input, token: 'secret', fileBytes: 999999 })).status, 200);
  assert.equal(f.logs.length, 1); assert.equal(f.logs[0].videoId, id);
  assert.equal(f.logs[0].source, 'browser_reported'); assert.equal(f.logs[0].fileBytes, 1024);
  assert.equal(f.logs[0].token, undefined); assert.equal(f.deferred.length, 1);
});
test('missing or malformed optional timings cannot block an otherwise valid upload', async () => {
  for (const timing of [undefined, {}, { ...input, transferMs: -1 }]) {
    const f = routeFixture(); assert.equal((await f.submit(timing)).status, 200);
    assert.equal(f.submissions, 1); assert.equal(f.logs.length, 0);
  }
});
test('unauthenticated or already accepted submissions do not produce timing samples', async () => {
  const denied = routeFixture({ authenticated: false });
  assert.equal((await denied.submit(input)).status, 400); assert.equal(denied.submissions, 0); assert.equal(denied.logs.length, 0);
  const duplicate = routeFixture({ accepted: true });
  assert.equal((await duplicate.submit(input)).status, 200); assert.equal(duplicate.logs.length, 0); assert.equal(duplicate.deferred.length, 0);
});
