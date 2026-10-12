import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const id = '11111111-1111-4111-8111-111111111111';
function fixture(kind, { denied = false, limited = false } = {}) {
  const calls = [], background = [], exports = {};
  class RateLimitError extends Error { retryAfterSeconds = 60; }
  const retry = async (_admin, owner, mediaId) => { calls.push(['retry', owner, mediaId]); return kind === 'photo' ? { decision: 'review' } : { id: mediaId, status: 'moderating' }; };
  const deps = {
    'next/server': { NextResponse: { json: Response.json }, after: job => background.push(job) },
    '@/src/lib/api': { apiError: error => Response.json({ ok: false, error: error.message }, { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async (_request, access) => {
      calls.push(['auth', access]); if (denied) throw new PublicApiError('AUTH_REQUIRED', 'Sign in required.', 401);
      return { user: { id: 'owner' }, session: {} };
    } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/dancr/media-request-rate-limit': { DancerMediaRateLimitError: RateLimitError,
      enforceDancerMediaRequestRateLimit: async (_admin, input) => { calls.push(['limit', input.userId]); if (limited) throw new RateLimitError(); } },
    '@/src/lib/dancr/image-moderation': { retryOwnDancerPhotoReview: retry },
    '@/src/lib/dancr/tv': { queueOwnMyDancrTvReviewRetry: retry, retryMyDancrTvAutomatedModeration: async (_admin, id) => calls.push(['worker', id]) },
    '@/src/lib/server-job': { VIDEO_PROCESSING_ROUTE_TIMEOUT_MS: 270000, VIDEO_PROCESSING_JOB_TIMEOUT_MS: 240000, runWithServerJob: job => job() },
  };
  const path = kind === 'photo' ? 'app/api/dancer/photos/route.ts' : 'app/api/dancer/tv/videos/[id]/route.ts';
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Response, performance, Error, console, require: name => deps[name] || {} });
  return { calls, background, run: (body = { action: 'retry', photoId: id, userId: 'attacker' }) => exports.PATCH(new Request('https://synthetic.invalid/api', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) }) };
}
for (const kind of ['photo', 'video']) {
  test(`${kind} retry uses authenticated ownership and rate limiting`, async () => {
    const h = fixture(kind); const response = await h.run();
    assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
    assert.deepEqual(h.calls.map(call => call[0]), ['auth', 'limit', 'retry']);
    assert.equal(h.calls[0][1].role, 'dancer'); assert.equal(h.calls[0][1].allowProfileSetup, true);
    assert.deepEqual(h.calls[2], ['retry', 'owner', id]);
    if (kind === 'video') { assert.equal(h.background.length, 1); await h.background[0](); assert.deepEqual(h.calls[3], ['worker', id]); }
  });
  for (const [options, status] of [[{ denied: true }, 401], [{ limited: true }, 429]]) test(`${kind} retry returns ${status} without processing`, async () => {
    const h = fixture(kind, options); assert.equal((await h.run()).status, status);
    assert.equal(h.calls.some(call => call[0] === 'retry'), false); assert.equal(h.background.length, 0);
  });
  test(`${kind} retry rejects unsupported actions`, async () => {
    const h = fixture(kind); assert.equal((await h.run({ action: 'approve', photoId: id })).status, 400);
    assert.equal(h.calls.some(call => call[0] === 'retry'), false);
  });
}
test('photo retry rejects missing or invalid record IDs', async () => {
  for (const photoId of [undefined, 'not-a-uuid', id + 'extra']) {
    const h = fixture('photo'); assert.equal((await h.run({ action: 'retry', photoId })).status, 400);
    assert.equal(h.calls.some(call => call[0] === 'retry'), false);
  }
});
