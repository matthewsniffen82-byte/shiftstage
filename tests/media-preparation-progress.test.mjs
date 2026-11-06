import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { isMediaProcessing } from '../app/dashboard/media-preparation-progress.ts';
import { loadMediaPreparationComponent } from './helpers/media-preparation-component.mjs';

test('upload indicator uses an accessible moving bar without a percentage or processing label', () => {
  const Component = loadMediaPreparationComponent().default;
  for (const label of ['Photo 1', 'Video 1', 'Main photo']) {
    const html = renderToStaticMarkup(Component({ label }));
    assert.match(html, /role="status">Uploading…/);
    assert.match(html, /class="dancer-upload-progress is-indeterminate"/);
    assert.ok(html.includes(`role="progressbar" aria-label="${label}: Uploading"`));
    assert.doesNotMatch(html, /aria-valuenow|aria-valuetext|\d%|Processing|estimated/);
  }
  const main = renderToStaticMarkup(Component({ label: 'Main photo', showLabel: false }));
  assert.doesNotMatch(main, /role="status"/, 'the main-photo status badge already supplies the visible label');
  assert.match(main, /aria-label="Main photo: Uploading"/);
});

test('processing receipts stay distinct from review-ready uploads and failed preparation', () => {
  for (const item of [{ status: 'moderating' }, { status: 'pending', moderationStatus: 'pending' }, { status: 'pending', moderationStatus: 'moderating' }]) {
    assert.equal(isMediaProcessing(item), true);
  }
  for (const item of [{ status: 'submitted', moderationStatus: 'submitted' }, { status: 'pending', moderationStatus: 'pending_review' },
    { status: 'approved' }, { status: 'failed' }, { status: 'rejected', moderationStatus: 'moderating' },
    { status: 'moderating', moderationStatus: 'moderation_error' }, { status: 'pending', moderationStatus: 'error' }]) {
    assert.equal(isMediaProcessing(item), false);
  }
});
