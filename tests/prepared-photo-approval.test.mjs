import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAvatarCaller } from './helpers/avatar-publication-fixture.mjs';

for (const avatar of [false, true]) {
  test(`${avatar ? 'avatar' : 'photo'} approval reuses prepared files and defers only cleanup`, async () => {
    const storagePath = `owner/profile/${avatar ? 'avatar/' : ''}prepared.webp`;
    const record = { id: 'review', user_id: 'owner', updated_at: '2026-10-22T00:00:00Z',
      decision: 'review', status: 'pending_review', upload_context: avatar ? 'profile_avatar' : 'profile_gallery:1',
      temporary_storage_path: 'owner/profile/private.webp', final_storage_path: storagePath,
      club_reviewed_at: '2026-10-22T00:00:00Z',
      category_flags: { file_checks_passed: true, publication_prepared: true } };
    const calls = [], deferred = [];
    const client = {
      from() {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'profile' } }) };
        return q;
      },
      storage: { from: () => ({
        download: () => assert.fail('Approval must not download prepared media'),
        remove: async () => { calls.push('cleanup'); },
      }) },
    };
    const publish = async (_client, input) => {
      assert.equal(input.storagePath, storagePath);
      assert.equal(input.expectedUpdatedAt, record.updated_at);
      assert.equal(input.reviewerId, 'admin');
      calls.push('publish');
      return { record: { ...record, decision: 'approved' }, profile: { avatar_storage_path: storagePath } };
    };
    const library = loadAvatarCaller('src/lib/dancr/image-review.ts', {
      publishDancerPhoto: publish, publishDancerAvatar: publish,
      uploadResponsiveImage: () => assert.fail('Approval must not resize or upload prepared media'),
      cleanPublishedGalleryFiles: async () => { calls.push('cleanup'); },
    });
    const result = await library.approveReviewRecord(client, record, 'admin', '', { deferCleanup: work => deferred.push(work) });
    assert.equal(result.decision, 'approved');
    assert.deepEqual(calls, ['publish']);
    assert.equal(deferred.length, 1);
    await deferred[0]();
    assert.deepEqual(calls, ['publish', 'cleanup']);
  });
}
