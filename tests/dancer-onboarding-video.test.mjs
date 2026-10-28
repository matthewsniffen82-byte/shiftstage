import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { dancerSubmissionVideoCount } from '../src/lib/dancr/dancer-submission-media.ts';

test('only distinct finished profile videos count toward onboarding', () => {
  const videos = [
    { id: 'approved', status: 'approved' },
    { id: 'approved', status: 'approved' },
    { id: 'pending', status: 'submitted', fileChecksPassed: true },
    { id: 'feed', status: 'approved', distributionScope: 'feed_only' },
    { id: 'failed', status: 'submitted', fileChecksPassed: false },
    { id: 'rejected', status: 'rejected', fileChecksPassed: true },
    { id: 'processing', status: 'moderating', fileChecksPassed: true },
    { status: 'approved' },
  ];
  assert.equal(dancerSubmissionVideoCount(videos), 2);
});

test('the upload hook preserves processing and distribution checks for the visible video count', async () => {
  const source = ts.transpileModule(readFileSync('app/dashboard/useDancerProfileVideos.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const effects = [], state = []; let cursor = 0;
  const rows = [
    { id: 'ready', status: 'submitted', moderationDetails: { fileChecksPassed: true } },
    { id: 'processing', status: 'submitted', moderationDetails: { fileChecksPassed: true }, uploadValidationPending: true },
    { id: 'feed', status: 'approved', distributionScope: 'feed_only' },
    { id: 'rejected', status: 'rejected', moderationDetails: { fileChecksPassed: true } },
  ];
  const exports = {}, deps = {
    useState(initial) { const index = cursor++; state[index] = initial; return [initial, value => { state[index] = value; }]; },
    useEffect: work => effects.push(work), readSession: () => ({ accessToken: 'fixture' }),
    requestDancerTvVideosJson: async () => ({ videos: rows }), DANCER_PROFILE_VIDEOS_CHANGED_EVENT: 'fixture:videos',
  };
  vm.runInNewContext(source, { exports, require: () => deps, AbortController,
    window: { clearTimeout() {}, setTimeout() { return 1; }, addEventListener() {}, removeEventListener() {} } });
  exports.useDancerProfileVideos('profile'); const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state[0], false); assert.equal(state[1], '');
  assert.equal(state[2].length, 4, 'rejected media stays in the dancer’s grid');
  assert.equal(dancerSubmissionVideoCount(state[2]), 1);
  cleanup();
});

const code = ts.transpileModule(readFileSync('app/api/admin/tv/videos/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ decision = 'approved', reviewFails = false, finalizeFails = false } = {}) {
  const callbacks = [], finalized = [], warnings = [], exports = {};
  const admin = { from(table) {
    assert.equal(table, 'mydancr_tv_videos');
    return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { submitted_by: 'owner' }, error: null }) };
  } };
  const deps = {
    after: callback => callbacks.push(callback), NextResponse: { json: (data, init) => Response.json(data, init) },
    createRequestSupabaseContext: async () => ({ client: {}, user: { id: 'admin' } }),
    requireAdmin: async () => {}, createAdminSupabaseClient: () => admin, claimAdminMedia: async () => {},
    readBoundedJsonObject: request => request.json(), PublicApiError: class extends Error {},
    reviewMyDancrTvVideo: async () => { if (reviewFails) throw new Error('Failed'); return { status: decision }; },
    runWithServerJob: work => work(), finalizePendingDancerNfcEnrollment: async (db, input) => {
      assert.equal(db, admin); finalized.push(input.dancerUserId); if (finalizeFails) throw new Error('Retry later');
    }, safeErrorMetadata: () => ({}),
  };
  vm.runInNewContext(code, { exports, require: () => deps, Error, Date, console: { warn: (...args) => warnings.push(args), error() {} } });
  return { callbacks, finalized, warnings, async run() {
    return exports.POST(new Request('https://test.invalid/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      videoId: '12345678-1234-4123-8123-123456789012', version: '2026-10-27T00:00:00Z', decision,
    }) }));
  } };
}

test('final video approval schedules completion of the owner’s saved check-in', async () => {
  const f = fixture(); assert.equal((await f.run()).status, 200);
  assert.equal(f.callbacks.length, 1); assert.deepEqual(f.finalized, []);
  await f.callbacks[0](); assert.deepEqual(f.finalized, ['owner']);
});

test('rejection and failed review never schedule activation', async () => {
  for (const options of [{ decision: 'rejected' }, { reviewFails: true }]) {
    const f = fixture(options); const response = await f.run();
    assert.equal(response.status, options.reviewFails ? 503 : 200); assert.equal(f.callbacks.length, 0);
  }
});

test('temporary check-in failure does not undo a saved video approval', async () => {
  const f = fixture({ finalizeFails: true }); const response = await f.run();
  assert.equal((await response.json()).video.status, 'approved');
  await f.callbacks[0](); assert.equal(f.warnings.length, 1);
});
