import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { mediaReview } from './helpers/media-review-label.mjs';
import { mediaBatchSummary, mediaUploadError } from '../app/dashboard/media-upload-feedback.ts';
import { MEDIA_UPLOAD_CONCURRENCY, runMediaUploadBatch } from '../app/dashboard/media-upload-batch.ts';
import { createMediaUploadCancellation } from '../app/dashboard/media-upload-cancellation.ts';
import { createPhotoCropQueue } from '../app/dashboard/photo-upload-crop-queue.ts';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/dashboard/DancerPhotoPanel.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const approved = { id: 'main', imageUrl: '/main.jpg', review_status: 'approved', sort_order: 0, is_primary: true };
const pending = { id: 'pending-main', previewUrl: '/pending.jpg', status: 'pending_review', upload_context: 'profile_main', is_primary: true };

// Run actual component handlers with in-memory uploads; no browser or external requests.
function fixture({ profile = {}, automaticMain = true, failFirst = false } = {}) {
  const slots = [], posts = [];
  let cursor = 0, dirty = true, effects = [], tree;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
        effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const dependencies = {
    react: hooks,
    '@/src/lib/dancr/media-review-label': mediaReview,
    '@/src/lib/dancr/media-limits': { MAX_DANCER_PROFILE_PHOTOS: 30, MIN_DANCER_ONBOARDING_PHOTOS: 3 },
    './DancerUploadFeedback': { DancerUploadSummary: 'Summary', DancerUploadProgress: 'Progress', usePendingUploadNotice() {} },
    './DancerPhotoBatchChoice': { default: 'BatchChoice' },
    './DancerPendingMediaGrid': { default: 'PendingGrid' },
    './media-upload-feedback': { mediaBatchSummary, mediaUploadError },
    './media-upload-batch': { MEDIA_UPLOAD_CONCURRENCY, runMediaUploadBatch },
    './media-upload-cancellation': { createMediaUploadCancellation },
    './photo-upload-crop-queue': { createPhotoCropQueue },
    './profile-photo-crop': { cropProfilePhoto: async file => file },
    './prepare-photo-upload': { preparePhotoUpload: async file => file },
    './default-photo-crop': { keepDefaultPhotoCrop: async file => file },
    './DashboardShared': { DANCER_PHOTOS_KEEP_OPEN_EVENT: 'photos-open' },
    './dashboard-session': {
      readSession: () => ({ accessToken: 'fixture', account: { id: 'owner' } }),
      requestDancerPhotosJson: async options => {
        posts.push(options);
        if (failFirst && posts.length === 1) throw new Error('Connection lost.');
        return { decision: 'review', photo: { id: `photo-${posts.length}`, isPrimary: options.body.get('isPrimary') === 'true', sortOrder: Number(options.body.get('sortOrder')) } };
      },
      requestDancerProfileJson: async () => ({ profile }),
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, FormData, AbortController, DOMException, Event, Error, crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} }, window: { dispatchEvent() {}, confirm: () => true },
    require: name => dependencies[name] || (name === 'react/jsx-runtime' ? require(name) : { default: name }),
  });
  const props = { profile, uploadOnly: true, automaticMain, mainPhotoAccessory: 'Avatar control', deletedPhotoIds: [], deletedPhotoStoragePaths: [] };
  function draw() {
    for (let pass = 0; dirty && pass < 20; pass++) {
      dirty = false; cursor = 0; effects = [];
      tree = exports.DancerPhotoPanel(props); effects.forEach(fn => fn());
    }
    assert.equal(dirty, false, 'component updates must settle');
    return walk(tree);
  }
  return {
    posts,
    nodes: draw,
    select(count = 1, source = 'gallery', keep = false) {
      const input = draw().find(node => node.type === 'input' && node.props.className === 'photo-source-input' && Boolean(node.props.capture) === (source === 'camera'));
      input.props.onChange({ target: { files: Array.from({ length: count }, (_, i) => new File(['image'], `photo-${i}.jpg`, { type: 'image/jpeg' })), value: '' } });
      const choice = draw().find(node => node.type === 'BatchChoice');
      if (choice) choice.props[keep ? 'onKeep' : 'onAdjust']();
    },
    async settle() { await new Promise(resolve => setImmediate(resolve)); draw(); },
  };
}

test('first upload reserves one main photo before parallel uploads for either crop choice', async () => {
  for (const keep of [true, false]) {
    const ui = fixture(); ui.select(3, 'gallery', keep); await ui.settle();
    assert.deepEqual(ui.posts.map(post => [post.body.get('isPrimary'), post.body.get('sortOrder')]), [['true', '0'], ['false', '1'], ['false', '2']]);
    assert.ok(ui.posts.every(post => post.body.get('replaceExisting') === 'false'));
  }
});

test('camera can create the first main photo while later uploads preserve approved or pending main photos', async () => {
  for (const profile of [{}, { dancer_photos: [approved] }, { pending_photo_reviews: [pending] }]) {
    const ui = fixture({ profile }); ui.select(1, 'camera'); await ui.settle();
    assert.equal(ui.posts.length, 1);
    assert.equal(ui.posts[0].body.get('isPrimary'), Object.keys(profile).length ? 'false' : 'true');
  }
});

test('failed main upload retries the reserved slot and same idempotency key', async () => {
  const ui = fixture({ failFirst: true }); ui.select(); await ui.settle();
  ui.nodes().find(node => node.type === 'button' && node.props.children === 'Retry').props.onClick(); await ui.settle();
  assert.equal(ui.posts.length, 2);
  assert.deepEqual(ui.posts.map(post => post.body.get('isPrimary')), ['true', 'true']);
  assert.equal(ui.posts[0].headers['idempotency-key'], ui.posts[1].headers['idempotency-key']);
});

test('pending main photo appears first with its avatar accessory only once', () => {
  const ui = fixture({ profile: { pending_photo_reviews: [{ ...pending, id: 'gallery', is_primary: false, upload_context: 'profile_gallery' }, pending] } });
  const items = ui.nodes().find(node => node.type === 'PendingGrid').props.items;
  assert.equal(items[0].id, 'pending-main'); assert.equal(items[0].label, 'Main photo');
  assert.equal(items[0].accessory, 'Avatar control'); assert.equal(items[1].accessory, undefined);
});
