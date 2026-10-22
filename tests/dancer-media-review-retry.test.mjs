import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { loadMediaRetryComponent } from './helpers/media-retry-component.mjs';

const retry = loadMediaRetryComponent();
for (const kind of ['photo', 'video']) {
  for (const status of ['pending', 'moderation_error', 'moderation_retry', 'error', 'moderating']) {
    test(`${kind} ${status} shows review retry`, () => {
      const html = renderToStaticMarkup(React.createElement(retry.default, { id: 'item', kind, status }));
      assert.match(html, new RegExp(`aria-label="Retry ${kind} review"`));
      assert.match(html, /type="button"/);
    });
  }
  for (const status of ['pending_review', 'review', 'submitted', 'completed', 'approved', 'live', 'rejected', 'denied', 'removed', 'hidden', 'expired', 'uploading', 'failed', 'unknown']) {
    test(`${kind} ${status} cannot restart moderation from the review button`, () => {
      assert.equal(renderToStaticMarkup(React.createElement(retry.default, { id: 'item', kind, status })), '');
    });
  }
}
test('final media state takes precedence over stale moderation metadata', () => {
  assert.equal(retry.canRetryMediaReview('approved', 'moderation_error'), false);
  assert.equal(retry.canRetryMediaReview('rejected', 'pending_review'), false);
  assert.equal(retry.canRetryMediaReview('pending', 'pending_review'), false);
});

function ui({ kind = 'photo', failure = false } = {}) {
  const slots = [], calls = [], busy = [], results = [], cleanup = [];
  let cursor = 0, owner = 'owner', finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const hooks = { ...React, useState(initial) {
    const i = cursor++; if (!(i in slots)) slots[i] = initial;
    return [slots[i], value => { slots[i] = value; }];
  }, useRef(initial) { return slots[cursor++] ||= { current: initial }; }, useEffect(effect) { cleanup.push(effect()); } };
  const request = async options => { calls.push(options); await pending; if (failure) throw Error('Review unavailable'); return { decision: 'approved', message: 'Approved' }; };
  const loaded = loadMediaRetryComponent({ hooks, api: {
    readSession: () => ({ account: { id: owner } }), requestDancerPhotosJson: request,
    requestDancerTvVideoJson: (id, options) => { assert.equal(id, 'item'); return request(options); },
    requestDancerProfileJson: async () => ({ profile: { id: 'profile', dancer_photos: [{ id: 'published', review_status: 'approved' }] } }),
  }, announce: () => results.push('video-refresh') });
  const draw = () => { cursor = 0; return loaded.default({ id: 'item', kind, status: 'pending', onBusyChange: value => busy.push(value), onRetried: value => results.push(value) }); };
  const button = () => React.Children.toArray(draw().props.children).find(child => child.type === 'button');
  return { button, draw, calls, busy, results, finish, switchOwner: () => { owner = 'other'; }, cleanup: () => cleanup[0]?.() };
}
test('a retry reuses its review id, blocks double taps and refreshes approved photo data', async () => {
  const h = ui(); const button = h.button(); button.props.onClick(); button.props.onClick();
  assert.equal(h.calls.length, 1); assert.deepEqual(JSON.parse(h.calls[0].body), { action: 'retry', photoId: 'item' });
  assert.equal(h.button().props.disabled, true);
  h.finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.results[0].profile.dancer_photos[0].review_status, 'approved');
  assert.deepEqual(h.busy, [true, false]); assert.equal(h.draw(), null);
});
test('video retry uses the saved id and refreshes the video list', async () => {
  const h = ui({ kind: 'video' }); h.button().props.onClick(); h.finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(h.calls[0].body), { action: 'retry' });
  assert.equal(h.results[0], 'video-refresh');
});
test('failed retry keeps the button and reports the failure', async () => {
  const h = ui({ failure: true }); h.button().props.onClick(); h.finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.button().props.disabled, false); assert.equal(h.results.length, 0);
  assert.match(renderToStaticMarkup(h.draw()), /Review unavailable/);
});
for (const cancel of ['switchOwner', 'cleanup']) test(`${cancel} ignores late review responses`, async () => {
  const h = ui(); h.button().props.onClick(); h[cancel](); h.finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.results.length, 0);
});

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function photoFixture(overrides = {}, race = false) {
  const record = { id: 'review', user_id: 'owner', status: 'pending_review', decision: 'review', review_decision: null,
    temporary_storage_path: 'owner/profile/source.jpg', updated_at: '2020-01-01T00:00:00.000Z', attempt_count: 4, ...overrides };
  const calls = [], processed = [];
  const admin = { from() {
    const filters = []; let update;
    const q = { select() { return q; }, eq(key, value) { filters.push(row => row[key] === value); return q; },
      is(key, value) { filters.push(row => row[key] === value); return q; }, update(value) { update = value; return q; },
      async maybeSingle() {
        if (update && race) { record.status = 'rejected'; record.decision = 'rejected'; }
        if (!filters.every(filter => filter(record))) return { data: null };
        if (update) { calls.push(['claim', update]); Object.assign(record, update); }
        return { data: { ...record } };
      } }; return q;
  }, storage: { from(bucket) { return {
    async download(path) { calls.push(['download', bucket, path]); return { data: new Blob(['test']) }; },
    async upload(path) { calls.push(['upload', bucket, path]); return { data: { path } }; },
    async remove(paths) { calls.push(['remove', bucket, paths]); return {}; },
  }; } } };
  const exports = {};
  const deps = { PublicApiError, MODERATION_WORKER_STALE_MS: 300000, runWithServerJob: fn => fn(),
    galleryReviewVersion: value => value, randomUUID: () => 'unique', requireStorageUploadReceipt: (data, _bucket, path) => assert.equal(data.path, path) };
  const source = readFileSync('src/lib/dancr/image-moderation.ts', 'utf8') + '\nprocessImageModerationRetryRecord = testProcessor;';
  vm.runInNewContext(compile(source), { exports, require: () => deps, Date, Error, Blob,
    testProcessor: async (_admin, claimed, options) => { processed.push({ claimed, options }); return { decision: 'review' }; } });
  return { record, calls, processed, run: (owner = 'owner') => exports.retryOwnDancerPhotoReview(admin, owner, 'review') };
}
for (const status of ['pending_review', 'moderation_error', 'moderation_retry', 'error', 'moderating']) test(`owner may retry ${status} using the original private file`, async () => {
  const h = photoFixture({ status }); await h.run();
  assert.equal(h.processed.length, 1); assert.equal(h.processed[0].options.manualRetry, true);
  assert.equal(h.record.attempt_count, 5); assert.equal(h.record.status, 'moderating');
  const copy = h.calls.filter(call => call[0] === 'upload');
  assert.equal(copy.length, status === 'pending_review' ? 1 : 0);
  if (copy.length) assert.equal(copy[0][1], 'dancr-image-moderation-temp');
});
for (const status of ['approved', 'rejected', 'removed', 'hidden']) test(`server rejects photo retry for ${status}`, async () => {
  const h = photoFixture({ status }); await assert.rejects(h.run(), /no longer waiting/); assert.equal(h.calls.length, 0);
});
test('photo retries cannot read another account, overwrite a human decision or duplicate active work', async () => {
  await assert.rejects(photoFixture().run('other'), /not found/);
  await assert.rejects(photoFixture({ review_decision: 'rejected' }).run(), /no longer waiting/);
  await assert.rejects(photoFixture({ updated_at: new Date().toISOString() }).run(), /wait before retrying/);
  const h = photoFixture({}, true); await assert.rejects(h.run(), /review changed/);
  assert.equal(h.processed.length, 0); assert.equal(h.record.status, 'rejected');
  assert.equal(h.calls.some(call => call[0] === 'remove' && call[1] === 'dancr-image-moderation-review'), false);
});
