import assert from 'node:assert/strict';
import test from 'node:test';
import { photoUploadPercent, photoBatchProgress } from '../app/dashboard/photo-upload-progress.ts';

test('photo percentages track transfer and finish before processing or final approval', () => {
  assert.equal(photoUploadPercent({ stage: 'queued' }), 0);
  assert.equal(photoUploadPercent({ stage: 'cropping' }), 0);
  assert.equal(photoUploadPercent({ stage: 'uploading', progress: 50 }), 50);
  assert.equal(photoUploadPercent({ stage: 'checking', progress: 100 }), 100);
  for (const moderationStatus of ['moderating', 'moderation_retry', 'moderation_error']) {
    assert.equal(photoUploadPercent(undefined, { status: 'pending', moderationStatus }), 100);
  }
  for (const result of [{ status: 'approved' }, { status: 'rejected' }, { status: 'pending', moderationStatus: 'pending_review' }]) {
    assert.equal(photoUploadPercent(undefined, result), 100);
  }
  assert.equal(photoUploadPercent({ stage: 'uploading', progress: NaN }), 0);
  assert.equal(photoUploadPercent({ stage: 'uploading', progress: 200 }), 100);
  assert.equal(photoUploadPercent(undefined, { status: 'uploading' }), 0);
  assert.equal(photoUploadPercent(undefined, { status: 'failed' }), 0);
});

test('overall photo progress includes waiting files and flags failures instead of claiming completion', () => {
  assert.equal(photoBatchProgress([]), null);
  assert.deepEqual(photoBatchProgress([
    { result: { status: 'pending', moderationStatus: 'pending_review' } },
    { result: { status: 'rejected' } },
    { item: { stage: 'uploading', progress: 50 } },
    { item: { stage: 'queued' } },
    { item: { stage: 'failed', error: 'Connection lost' } },
  ]), { percent: 50, completed: 2, total: 5, needsAttention: true });
});
