import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function load(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Buffer, Error, URL, AbortSignal, console: { error() {} },
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, ...globals });
  return exports;
}
test('dispatch sends only a job ID to the configured worker and never follows a credential redirect', async () => {
  const requests = [];
  const runtime = load('src/lib/dancr/video-worker-dispatch.ts', { 'server-only': {} }, {
    process: { env: { CRON_SECRET: 'fixture-secret', NEXT_PUBLIC_SITE_URL: 'https://example.invalid', NODE_ENV: 'production' } },
    fetch: async (url, init) => { requests.push({ url: String(url), ...init }); return Response.json({ ok: true }); },
  });
  await runtime.dispatchVideoModeration(id);
  assert.equal(requests[0].url, 'https://example.invalid/api/cron/video-moderation');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].redirect, 'error');
  assert.equal(requests[0].headers.authorization, 'Bearer fixture-secret');
  assert.deepEqual(JSON.parse(requests[0].body), { videoId: id });
});
for (const env of [{}, { CRON_SECRET: 'fixture' }, { CRON_SECRET: 'fixture', NEXT_PUBLIC_SITE_URL: 'http://external.invalid', NODE_ENV: 'production' }]) {
  test('invalid worker configuration cannot leak credentials or start processing', async () => {
    const runtime = load('src/lib/dancr/video-worker-dispatch.ts', { 'server-only': {} }, {
      process: { env }, fetch: () => { throw new Error('must not fetch'); },
    });
    await assert.rejects(runtime.dispatchVideoModeration(id), /worker/);
  });
}
for (const [authorized, body, status] of [[false, { videoId: id }, 401], [true, { videoId: 'bad' }, 400], [true, { videoId: id }, 200]]) {
  test(`dedicated worker validates authentication and job input (${status})`, async () => {
    const jobs = [], budgets = [];
    const route = load('app/api/cron/video-moderation/route.ts', {
      'next/server': { NextResponse: { json: Response.json } },
      '@/src/lib/bounded-json-body': { readBoundedJsonObject },
      '@/src/lib/dancr/cron-auth': { authorizeCronRequest: () => authorized ? null : Response.json({}, { status: 401 }) },
      '@/src/lib/dancr/tv': { retryMyDancrTvAutomatedModeration: async (_admin, videoId) => { jobs.push(videoId); return null; } },
      '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
      '@/src/lib/security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
      '@/src/lib/server-job': { MODERATION_WORKER_STALE_MS: 300000, VIDEO_PROCESSING_ROUTE_TIMEOUT_MS: 270000,
        runWithServerJob: async (operation, ms) => { budgets.push(ms); return operation(); } },
    });
    const response = await route.POST(new Request('https://example.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    assert.equal(response.status, status);
    assert.deepEqual(jobs, status === 200 ? [id] : []);
    assert.deepEqual(budgets, status === 200 ? [270000] : []);
    if (status === 200) assert.deepEqual(await response.json(), { ok: true, status: 'not_claimed' });
  });
}
