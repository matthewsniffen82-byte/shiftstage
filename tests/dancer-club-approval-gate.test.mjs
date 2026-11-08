import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const compiled = ts.transpileModule(readFileSync('app/api/venue/media-reviews/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = '12345678-1234-4123-8123-123456789012', version = 'a'.repeat(32);

function fixture(kind = 'photo', options = {}) {
  const calls = [];
  const record = { id, status: 'approved', upload_context: 'profile_gallery:1', ...options.record };
  const item = { id, kind, source: kind === 'photo' ? 'upload' : 'video', dancerId: id, contentVersion: version, record };
  const admin = { rpc: async (name, args) => {
    calls.push({name, args});
    assert.equal(name, 'get_club_media_queue');
    return {data: {items: [item], count: 1, dancers: []}};
  }};
  const deps = {
    PublicApiError, NextResponse: {json: body => body}, apiError: error => ({status: error.status, message: error.message}),
    createRequestSupabaseContext: async () => ({user: {id: 'reviewer'}, session: {}}), createAdminSupabaseClient: () => admin,
    requireActiveVenueAccount: async () => {}, requireVenueAccess: async () => ({venueId: 'venue', role: 'manager'}),
    withSignedThumbnail: async () => ({thumbnailUrl: 'preview'}), mainPhotoPreviews: async () => new Map(),
  };
  const route = {};
  vm.runInNewContext(compiled, {exports: route, require: () => deps, URL, console});
  return {calls, get: () => route.GET({url: 'https://example.test/api/venue/media-reviews'}),
    post: decision => route.POST({body: {...item, decision, venueId: 'untrusted-other-club'}})};
}
for (const kind of ['photo', 'video']) test(kind + ': individual decisions must go through the batch review', async () => {
  for (const decision of ['approved', 'rejected']) {
    const f = fixture(kind);
    const result = await f.post(decision);
    assert.equal(result.status, 409);
    assert.match(result.message, /Open the media batch/);
    assert.deepEqual(f.calls, []);
  }
});

test('published items and items awaiting final approval have distinct review guidance', async () => {
  const published = (await fixture().get()).items[0];
  assert.equal(published.canApprove, true);
  assert.match(published.reviewSummary, /MyDancr approved/);
  const pending = (await fixture('photo', {record:{status:'pending_review',category_flags:{file_checks_passed:true}}}).get()).items[0];
  assert.equal(pending.canApprove, true);
  assert.equal(pending.contentVersion, version);
  assert.match(pending.reviewSummary, /MyDancr final approval/);
});
