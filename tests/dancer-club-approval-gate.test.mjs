import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { mediaReview } from './helpers/media-review-label.mjs';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../app/api/venue/media-reviews/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = '12345678-1234-4123-8123-123456789012';
const version = '2026-10-22T00:00:00Z';
function fixture(kind, fields) {
  const record = { id, updated_at: version, status: kind === 'photo' ? 'pending_review' : 'submitted',
    upload_context: 'profile_gallery:1', user_id: 'dancer', submitted_by: 'dancer', ...fields };
  const decisions = [];
  const admin = {
    from() { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: record }) }; return q; },
    rpc: async name => ({ data: name === 'get_venue_dancer_media_review' ? { count: 1, items: [{ id, kind, record }] } : true }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'private-preview' } }) }) },
  };
  const deps = {
    ...mediaReview, PublicApiError, NextResponse: { json: body => body },
    apiError: error => ({ status: error.status, message: error.message }),
    readBoundedJsonObject: async request => request.body,
    runWithServerJob: work => work(),
    createRequestSupabaseContext: async () => ({ user: { id: 'reviewer' }, session: {} }),
    createAdminSupabaseClient: () => admin,
    requireActiveVenueAccount: async () => {}, requireVenueAccess: async () => ({ venueId: 'venue', role: 'manager' }),
    withSignedThumbnail: async () => ({ thumbnailUrl: 'private-preview' }),
    approveReviewRecord: async () => decisions.push('approved'), rejectReviewRecord: async () => decisions.push('rejected'),
    reviewMyDancrTvVideo: async (_admin, _reviewer, _id, decision) => decisions.push(decision),
    finalizePendingDancerNfcEnrollment: async () => {}, recordVenueActivity: async () => {},
  };
  const route = {};
  vm.runInNewContext(compiled, { exports: route, require: () => deps, URL, console });
  return { decisions, get: () => route.GET({ url: 'https://example.test/api/venue/media-reviews' }),
    post: (decision = 'approved', notes = 'Logo visible') => route.POST({ body: { id, kind, version, decision, notes } }) };
}

for (const kind of ['photo', 'video']) {
  test(`${kind}: a club rejection requires one to three words`, async () => {
    const f = fixture(kind, {});
    for (const reason of ['', '   ', 'This reason has four']) {
      assert.equal((await f.post('rejected', reason)).status, 400);
      assert.equal(f.decisions.length, 0);
    }
    assert.equal((await f.post('rejected', 'Nudity')).ok, true);
  });
  for (const decision of ['approved', 'review', 'rejected', null]) test(`${kind}: only an automated pass enables and accepts Club approval (${decision})`, async () => {
    const f = fixture(kind, kind === 'photo' ? { category_flags: {
      ai_recommended_approval: decision === 'approved', ai_recommended_rejection: decision === 'rejected',
    } } : { moderation_decision: decision });
    const queue = await f.get();
    assert.equal(queue.items[0].canApprove, decision === 'approved');
    assert.doesNotMatch(queue.items[0].aiSummary, /manual review|human review/i);
    const result = await f.post();
    if (decision === 'approved') { assert.equal(result.ok, true); assert.deepEqual(f.decisions, ['approved']); }
    else { assert.equal(result.status, 409); assert.deepEqual(f.decisions, []); }
  });
  test(`${kind}: the club can still reject an unchecked legacy upload with a reason`, async () => {
    const f = fixture(kind, {});
    assert.equal((await f.post('rejected')).ok, true);
    assert.deepEqual(f.decisions, ['rejected']);
  });
}

test('contradictory photo flags cannot bypass automated checks', async () => {
  const f = fixture('photo', { category_flags: { ai_recommended_approval: true, ai_recommended_rejection: true } });
  assert.equal((await f.get()).items[0].canApprove, false);
  assert.equal((await f.post()).status, 409);
  assert.deepEqual(f.decisions, []);
});
