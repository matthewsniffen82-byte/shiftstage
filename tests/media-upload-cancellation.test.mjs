import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaUploadCancellation } from '../app/dashboard/media-upload-cancellation.ts';

test('cancel stops transfers and queued files while completed uploads retain their review response', () => {
  const parent = new AbortController();
  const batch = createMediaUploadCancellation(parent.signal);
  const transferring = batch.start(), checking = batch.start();
  checking.beginReview();
  batch.cancel(); batch.cancel();
  assert.equal(batch.canceled, true);
  assert.equal(transferring.signal.aborted, true);
  assert.throws(() => transferring.beginReview(), { name: 'AbortError' });
  assert.equal(checking.signal.aborted, false);
  assert.equal(parent.signal.aborted, false);
  assert.equal(batch.start(), null);
  transferring.finish(); checking.finish();
});

test('leaving the dashboard aborts transfers and reviews, even after canceling only transfers', () => {
  const parent = new AbortController();
  const batch = createMediaUploadCancellation(parent.signal);
  const checking = batch.start(); checking.beginReview();
  batch.cancel(); parent.abort();
  assert.equal(checking.signal.aborted, true);
  assert.equal(batch.start(), null);
  checking.finish();
});

test('finished uploads release cancellation listeners and a new batch can retry', () => {
  const parent = new AbortController();
  const batch = createMediaUploadCancellation(parent.signal);
  const finished = batch.start(); finished.finish();
  batch.cancel(); parent.abort();
  assert.equal(finished.signal.aborted, false);
  const retry = createMediaUploadCancellation(new AbortController().signal).start();
  assert.equal(retry.signal.aborted, false); retry.finish();
});
