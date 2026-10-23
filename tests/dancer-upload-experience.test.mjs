import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mediaBatchSummary, mediaUploadError } from '../app/dashboard/media-upload-feedback.ts';
import { timeMediaStage } from '../src/lib/dancr/media-processing-timing.ts';
import { createPhotoCropQueue } from '../app/dashboard/photo-upload-crop-queue.ts';
import { runMediaUploadBatch, MEDIA_UPLOAD_CONCURRENCY } from '../app/dashboard/media-upload-batch.ts';
import { createMediaUploadCancellation } from '../app/dashboard/media-upload-cancellation.ts';
import * as mediaLimits from '../src/lib/dancr/media-limits.ts';
import { mediaReview } from './helpers/media-review-label.mjs';

const require = createRequire(import.meta.url);
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, File, Blob, FormData, DOMException, Error, ...globals,
    require: name => dependencies[name] || require(name) });
  return exports;
}
const feedback = load('app/dashboard/DancerUploadFeedback.tsx');

test('batch counts only confirmed saved files, keeps failures in the total, and handles empty/canceled batches', () => {
  assert.equal(mediaBatchSummary([]), null);
  assert.deepEqual(mediaBatchSummary([{ saved: true }, { saved: false }, { saved: false, failed: true }]),
    { completed: 1, total: 3, needsAttention: true, allSaved: false });
  assert.equal(mediaBatchSummary([{ saved: true, failed: true }]).allSaved, false);
  assert.equal(mediaBatchSummary([{ saved: true }, { saved: true }]).allSaved, true);
});

test('leaving advice appears only after every receipt and while the entire workspace is safe to leave', () => {
  for (const busy of [true, false]) for (const canLeave of [true, false]) for (const saved of [true, false]) {
    const summary = mediaBatchSummary([{ saved }]);
    const html = renderToStaticMarkup(React.createElement(feedback.DancerCanLeaveUploadContext.Provider, { value: canLeave },
      React.createElement(feedback.DancerUploadSummary, { summary, busy })));
    assert.equal(html.includes('You can leave'), saved && !busy && canLeave);
    assert.match(html, new RegExp(`${saved ? 1 : 0} of 1 uploaded`));
    assert.doesNotMatch(html, /role="progressbar"/);
  }
});

test('photo and video progress use the same accessible determinate or indeterminate rendering', () => {
  for (const label of ['Photo 1: Uploading', 'Video 1: Uploading']) {
    const html = renderToStaticMarkup(React.createElement(feedback.DancerUploadProgress, { label, progress: 42 }));
    assert.match(html, /aria-valuenow="42"/); assert.match(html, /width:42%/);
    const waiting = renderToStaticMarkup(React.createElement(feedback.DancerUploadProgress, { label }));
    assert.match(waiting, /is-indeterminate/); assert.doesNotMatch(waiting, /aria-valuenow/);
  }
});

test('bulk crop choices keep adjustment and cancellation available without auto-starting uploads', () => {
  const { default: Choice } = load('app/dashboard/DancerPhotoBatchChoice.tsx');
  const calls = [];
  const tree = Choice({ photos: [{ id: '1', previewUrl: '/1.jpg' }, { id: '2', previewUrl: '/2.jpg' }],
    onKeep: () => calls.push('keep'), onAdjust: () => calls.push('adjust'), onCancel: () => calls.push('cancel') });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /2 photos selected/); assert.match(html, /Keep all crops/);
  assert.match(html, /Adjust individually/); assert.equal(calls.length, 0);
  for (const button of tree.props.children.at(-1).props.children) button.props.onClick();
  assert.deepEqual(calls, ['keep', 'adjust', 'cancel']);
});

test('upload errors explain a short next action without leaking server details', () => {
  for (const kind of ['photo', 'video']) {
    assert.match(mediaUploadError(new Error('Network failed to fetch'), kind), /connection.*Retry/);
    assert.match(mediaUploadError(new Error('authorization expired'), kind), /Sign in again/);
    assert.match(mediaUploadError(new Error('25 MB maximum'), kind), /25 MB/);
    assert.match(mediaUploadError(new Error('private storage path /owner/secret token'), kind), /Tap Retry/);
    assert.doesNotMatch(mediaUploadError(new Error('private storage path /owner/secret token'), kind), /secret|owner/);
  }
  assert.match(mediaUploadError('HEIC conversion failed', 'photo'), /JPEG or PNG/);
  assert.match(mediaUploadError('MP4 decode failed', 'video'), /MP4 or MOV/);
});

function cropFixture({ fallback = false, afterDecode = () => {} } = {}) {
  const calls = [], canvases = []; let closed = false;
  const crop = load('app/dashboard/default-photo-crop.ts', {
    './dashboard-session': { requestDashboardJson: async () => { calls.push('fallback'); return { imageDataUrl: 'data:image/jpeg;base64,fixture' }; } },
  }, {
    createImageBitmap: async () => { if (fallback) throw Error('unsupported'); afterDecode(); return { width: 1200, height: 1600, close() { closed = true; } }; },
    Image: class { naturalWidth = 1200; naturalHeight = 1600; async decode() { afterDecode(); } },
    document: { createElement() { const canvas = { width: 0, height: 0,
      getContext: () => ({ drawImage: (...args) => calls.push(args.slice(1)) }),
      toBlob(callback, type) { callback(new Blob(['crop'], { type })); },
    }; canvases.push(canvas); return canvas; } },
  });
  return { crop: crop.keepDefaultPhotoCrop, calls, canvases, get closed() { return closed; } };
}

for (const fallback of [false, true]) test(`bulk crop matches centered 9:16 preview and releases image memory (fallback=${fallback})`, async () => {
  const f = cropFixture({ fallback });
  const result = await f.crop(new File(['original'], 'photo.jpg', { type: 'image/jpeg', lastModified: 42 }), new AbortController().signal);
  assert.equal(result.type, 'image/jpeg'); assert.equal(result.lastModified, 42);
  assert.deepEqual(Array.from(f.calls.at(-1)), [150, 0, 900, 1600, 0, 0, 900, 1600]);
  assert.equal(f.canvases[0].width, 0); assert.equal(f.canvases[0].height, 0);
  assert.equal(f.calls.includes('fallback'), fallback); if (!fallback) assert.equal(f.closed, true);
});

test('canceling a bulk crop before encoding returns no uploadable file', async () => {
  const controller = new AbortController();
  const f = cropFixture({ afterDecode: () => controller.abort() });
  await assert.rejects(f.crop(new File(['original'], 'photo.jpg'), controller.signal), { name: 'AbortError' });
  assert.equal(f.closed, true); assert.equal(f.canvases.length, 0);
});

test('processing timings record successful and failed stages without changing their result', async () => {
  const context = { videoId: 'synthetic', attempt: 1, stages: {} };
  assert.equal(await timeMediaStage('video', 'encode_mobile', async () => 'encoded', context), 'encoded');
  const failure = Error('synthetic interruption');
  await assert.rejects(timeMediaStage('video', 'source_download', async () => { throw failure; }, context), error => error === failure);
  for (const stage of ['encode_mobile', 'source_download']) assert.ok(Number.isFinite(context.stages[stage]) && context.stages[stage] >= 0);
});

function photoPanelFixture({ crop, profile = { id: 'profile' } } = {}) {
  const slots = [], effects = [], requests = [], crops = [];
  let cursor = 0, dirty = true, tree;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; const slot = slots[i] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, value => { slot.value = typeof value === 'function' ? value(slot.value) : value; dirty = true; }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i];
      if (!old || deps.some((value, j) => value !== old.deps[j])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const dependencies = {
    react: hooks, 'react/jsx-runtime': require('react/jsx-runtime'),
    '@/src/lib/dancr/media-limits': mediaLimits, '@/src/lib/dancr/media-review-label': mediaReview,
    './DashboardShared': { DANCER_PHOTOS_KEEP_OPEN_EVENT: 'keep-open' },
    './DancerPhotoBatchChoice': { default: 'CropChoice' },
    './DancerUploadFeedback': { DancerUploadSummary: 'UploadSummary', DancerUploadProgress: 'UploadProgress', usePendingUploadNotice() {} },
    './media-upload-feedback': { mediaBatchSummary, mediaUploadError },
    './photo-upload-crop-queue': { createPhotoCropQueue },
    './media-upload-batch': { runMediaUploadBatch, MEDIA_UPLOAD_CONCURRENCY },
    './media-upload-cancellation': { createMediaUploadCancellation },
    './profile-photo-crop': { cropProfilePhoto: async (...args) => { crops.push('individual'); return crop ? crop(...args) : args[0]; } },
    './default-photo-crop': { keepDefaultPhotoCrop: async file => { crops.push('batch'); return file; } },
    './prepare-photo-upload': { preparePhotoUpload: async file => file },
    './dashboard-session': {
      readSession: () => ({ accessToken: 'synthetic', account: { id: 'owner' } }),
      requestDancerPhotosJson: options => new Promise((resolve, reject) => requests.push({ options, resolve, reject })),
      requestDancerProfileJson: async () => ({}),
    },
  };
  const exports = {}, source = ts.transpileModule(readFileSync('app/dashboard/DancerPhotoPanel.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, File, FormData, URL, AbortController, DOMException, Error, Event,
    crypto: globalThis.crypto, window: new EventTarget(), require: name => dependencies[name] || { default: name } });
  const props = { profile, deletedPhotoIds: [], deletedPhotoStoragePaths: [] };
  const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
  function draw() {
    for (let iteration = 0; dirty && iteration < 20; iteration++) {
      dirty = false; cursor = 0; tree = exports.DancerPhotoPanel(props); effects.splice(0).forEach(fn => fn());
    }
    assert.equal(dirty, false); return walk(tree);
  }
  draw();
  return { requests, crops, draw,
    choose(files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })]) { draw().find(node => node.type === 'input' && node.props.multiple).props.onChange({ target: {
      files, value: '',
    } }); draw(); },
    get choice() { return draw().find(node => node.type === 'CropChoice'); },
    get summary() { return draw().find(node => node.type === 'UploadSummary').props; },
    get cards() { return draw().filter(node => node.props.className?.includes('dancer-upload-review-card')); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); draw(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

for (const keep of [true, false]) test(`photo batch waits for crop consent and counts server receipts, keepAll=${keep}`, async () => {
  const f = photoPanelFixture();
  try {
    f.choose(); assert.equal(f.requests.length, 0); assert.equal(f.summary.summary, null); assert.equal(f.cards.length, 0);
    f.choice.props[keep ? 'onKeep' : 'onAdjust'](); await f.settle();
    assert.deepEqual(f.crops, [keep ? 'batch' : 'individual', keep ? 'batch' : 'individual']);
    assert.equal(f.requests.length, 2);
    f.requests.forEach(({ options }) => options.onUploadProgress(100));
    assert.equal(f.summary.summary.completed, 0); assert.equal(f.summary.busy, true);
    f.requests[0].resolve({ decision: 'pending_review', photo: { id: 'photo-1', sortOrder: 1 } }); await f.settle();
    assert.equal(f.summary.summary.completed, 1); assert.equal(f.summary.busy, true);
    f.requests[1].resolve({ decision: 'pending_review', photo: { id: 'photo-2', sortOrder: 2 } }); await f.settle();
    assert.equal(f.summary.summary.completed, 2); assert.equal(f.summary.summary.allSaved, true); assert.equal(f.summary.busy, false);
    const labels = f.draw().filter(node => node.type === 'small' && node.props.role === 'status').map(node => node.props.children);
    assert.deepEqual(labels, ['Awaiting final approval', 'Awaiting final approval']);
  } finally { f.unmount(); }
});

test('canceling batch crop selection releases the queue without uploading', () => {
  const f = photoPanelFixture();
  try { f.choose(); f.choice.props.onCancel(); assert.equal(f.choice, undefined); assert.equal(f.summary.summary, null); assert.equal(f.requests.length, 0); }
  finally { f.unmount(); }
});

function deferredCrops() {
  const dialogs = [];
  return { dialogs, crop: (file, signal, _assertSession, _ratio, _preview, _onCrop, batch) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    dialogs.push({ confirm: () => resolve(file), skip: () => resolve(null), cancel: batch.onCancelBatch,
      fail: () => reject(new Error('Unable to prepare photo')) });
  }) };
}

test('a photo appears in upload status only after confirming its crop', async () => {
  const pending = deferredCrops(), f = photoPanelFixture(pending);
  try {
    f.choose([new File(['a'], 'a.jpg', { type: 'image/jpeg' })]); await f.settle();
    assert.equal(pending.dialogs.length, 1);
    assert.equal(f.cards.length, 0); assert.equal(f.summary.summary, null); assert.equal(f.requests.length, 0);
    pending.dialogs[0].confirm(); await f.settle();
    assert.equal(f.cards.length, 1); assert.equal(f.summary.summary.total, 1); assert.equal(f.requests.length, 1);
    f.requests[0].reject(new Error('Network failed')); await f.settle();
    assert.equal(f.cards.length, 1);
    assert.ok(f.draw().some(node => node.type === 'button' && node.props.children === 'Retry'));
  } finally { f.unmount(); }
});

for (const action of ['cancel', 'skip', 'fail']) test(`unconfirmed photo leaves no upload card after crop ${action}`, async () => {
  const pending = deferredCrops(), f = photoPanelFixture(pending);
  try {
    f.choose([new File(['a'], 'a.jpg', { type: 'image/jpeg' })]); await f.settle();
    pending.dialogs[0][action](); await f.settle();
    assert.equal(f.cards.length, 0); assert.equal(f.summary.summary, null); assert.equal(f.requests.length, 0);
    assert.equal(f.summary.busy, false);
    assert.ok(!f.draw().some(node => node.props.children === 'Upload canceled'));
    // A dismissed draft must not occupy a profile slot or prevent another selection.
    f.choose(); assert.ok(f.choice); f.choice.props.onCancel();
  } finally { f.unmount(); }
});

test('canceling remaining individual crops preserves only the already confirmed photo', async () => {
  const pending = deferredCrops(), f = photoPanelFixture(pending);
  try {
    f.choose(['a', 'b', 'c'].map(name => new File([name], `${name}.jpg`, { type: 'image/jpeg' })));
    f.choice.props.onAdjust(); await f.settle();
    assert.equal(f.cards.length, 0); assert.equal(pending.dialogs.length, 1);
    pending.dialogs[0].confirm(); await f.settle();
    assert.equal(pending.dialogs.length, 2); assert.equal(f.cards.length, 1);
    f.requests[0].resolve({ decision: 'pending_review', photo: { id: 'saved-photo', sortOrder: 1 } }); await f.settle();
    pending.dialogs[1].cancel(); await f.settle();
    assert.equal(pending.dialogs.length, 2); assert.equal(f.requests.length, 1); assert.equal(f.cards.length, 1);
    assert.equal(f.summary.summary.total, 1); assert.equal(f.summary.summary.completed, 1); assert.equal(f.summary.busy, false);
    const labels = f.draw().filter(node => node.type === 'small' && node.props.role === 'status').map(node => node.props.children);
    assert.deepEqual(labels, ['Awaiting final approval']);
  } finally { f.unmount(); }
});

test('invalid selections explain the issue without adding an unconfirmed photo card', () => {
  const f = photoPanelFixture();
  try {
    f.choose([new File(['text'], 'file.txt', { type: 'text/plain' })]);
    assert.equal(f.cards.length, 0); assert.equal(f.summary.summary, null); assert.equal(f.requests.length, 0);
    assert.ok(f.draw().some(node => String(node.props.children).includes('Choose a JPEG')));
  } finally { f.unmount(); }
});
