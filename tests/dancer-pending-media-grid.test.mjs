import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mediaReview } from './helpers/media-review-label.mjs';
import { mediaBatchSummary, mediaUploadError } from '../app/dashboard/media-upload-feedback.ts';
import { isVideoProcessingStalled } from '../src/lib/dancr/video-processing-state.ts';

const require = createRequire(import.meta.url);
function load(file, dependencies, globals = {}, exportName = 'default') {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, AbortController, Error, DOMException, ...globals,
    require: name => dependencies[name] || (name === 'react/jsx-runtime' ? require(name) : { default: name }) });
  return exports[exportName];
}
const Preview = load('app/dashboard/DancerVideoPreview.tsx', {
  react: React,
  './DancerVideoThumbnail': { default: ({ videoUrl }) => React.createElement('span', { 'data-video-preview': videoUrl }) },
});
const Grid = load('app/dashboard/DancerPendingMediaGrid.tsx', {
  react: { useContext: () => null },
  './DancerVideoPreview': { default: Preview },
});
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];

test('pending grid groups all media under one heading and preserves each compact removal action', () => {
  const removed = [];
  const items = Array.from({ length: 11 }, (_, index) => ({
    id: String(index), kind: index % 2 ? 'video' : 'photo', label: `${index % 2 ? 'Video' : 'Photo'} ${index + 1}`,
    imageUrl: `/preview-${index}.jpg`, videoUrl: `/video-${index}.mp4`, onRemove: () => removed.push(index),
  }));
  const tree = Grid({ items }), html = renderToStaticMarkup(tree);
  assert.equal((html.match(/>Awaiting final approval</g) || []).length, 1);
  assert.equal((html.match(/<li>/g) || []).length, 11, 'show the complete queue beyond the first three rows');
  const buttons = walk(tree).filter(node => node.type === 'button');
  assert.equal(buttons.length, 11); assert.ok(buttons.every(button => button.props.children === 'Remove'));
  buttons[7].props.onClick(); assert.deepEqual(removed, [7]);
  assert.equal(buttons[7].props['aria-label'], 'Remove video 8');
  assert.match(html, /data-video-preview="\/video-1.mp4"/);
  assert.equal((html.match(/aria-label="Play video /g) || []).length, 5);
  assert.doesNotMatch(html, /role="img"/, 'play controls must remain accessible inside the cards');
  assert.match(html, /alt="Photo 1"/);
  assert.equal(Grid({ items: [] }), null);
});

test('pending removal stays disabled while its request is in flight', () => {
  const tree = Grid({ items: [{ id: 'one', kind: 'photo', label: 'Photo 1', removing: true, onRemove() {} }] });
  const button = walk(tree).find(node => node.type === 'button');
  assert.equal(button.props.disabled, true); assert.equal(button.props.children, 'Removing…');
});

test('pending videos remain playable during other uploads but stop accepting playback while being removed', () => {
  for (const removing of [false, true]) {
    const tree = Grid({ items: [{ id: 'video', kind: 'video', label: 'Video 1', videoUrl: '/pending.mp4', disabled: true, removing, onRemove() {} }] });
    const preview = walk(tree).find(node => node.type === Preview);
    assert.equal(preview.props.videoUrl, '/pending.mp4');
    assert.equal(preview.props.disabled, removing);
    assert.equal(walk(tree).find(node => node.type === 'button').props.disabled, true);
  }
});

test('photo uploads retain their source label and Gallery and Camera without a duplicate pending action', () => {
  const Panel = load('app/dashboard/DancerPhotoPanel.tsx', {
    react: { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useRef: initial => ({ current: initial }), useEffect() {} },
    '@/src/lib/dancr/media-review-label': mediaReview,
    '@/src/lib/dancr/media-limits': { MAX_DANCER_PROFILE_PHOTOS: 30, MIN_DANCER_ONBOARDING_PHOTOS: 3 },
    './DancerPendingMediaGrid': { default: Grid },
    './DancerUploadFeedback': { DancerUploadSummary: 'Summary', usePendingUploadNotice() {} },
    './media-upload-feedback': { mediaBatchSummary },
  }, {}, 'DancerPhotoPanel');
  for (const uploadOnly of [true, false]) {
    const tree = Panel({ uploadOnly, profile: { pending_photo_reviews: [
      { id: 'waiting', status: 'pending_review', previewUrl: '/waiting.jpg', club_reviewed_at: '2026-10-22' },
    ] } });
    const nodes = walk(tree);
    const form = nodes.find(node => node.props.className === 'dancer-photo-upload-form');
    const heading = walk(form).filter(node => node.props.className === 'photo-source-heading');
    assert.equal(heading.length, 1); assert.equal(heading[0].type, 'strong');
    assert.equal(heading[0].props.children, uploadOnly ? 'More photos' : 'Add photos');
    const inputs = walk(form).filter(node => node.type === 'input');
    const buttons = walk(form).filter(node => node.type === 'button');
    assert.equal(buttons.length, 2);
    assert.deepEqual(buttons.map(node => node.props['aria-label']), ['Choose profile photos from your library', 'Take a new profile photo']);
    const opened = [];
    inputs.forEach((node, index) => { node.props.ref.current = { click: () => opened.push(index) }; });
    buttons.forEach(node => node.props.onClick());
    assert.deepEqual(opened, [0, 1]);
    assert.equal(inputs[0].props.multiple, true); assert.equal(inputs[1].props.capture, 'environment');
    const pending = nodes.find(node => node.type === Grid);
    assert.equal(pending.props.addMore, undefined);
    const html = renderToStaticMarkup(Grid(pending.props));
    assert.match(html, /Awaiting final approval/); assert.match(html, /src="\/waiting.jpg"/);
    assert.match(html, />Remove<\/button>/); assert.doesNotMatch(html, /Add more photos/);
  }
  const css = readFileSync('app/dashboard/dancer-profile-photos.css', 'utf8');
  assert.match(css, /\.dancer-upload-picker \.photo-source-heading\s*\{\s*display:none;/,
    'the standalone disclosure already labels the box and must not repeat its heading');
});

function videoFixture(initial) {
  let cursor = 0, dirty = true, tree, rows = initial;
  const slots = [], effects = [], calls = [];
  const hooks = {
    useState(initial) { const i = cursor++, slot = slots[i] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i];
      if (!old || deps.some((value, j) => value !== old.deps[j])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useCallback(fn, deps) { const i = cursor++, old = slots[i];
      if (!old || deps.some((value, j) => value !== old.deps[j])) slots[i] = { deps, fn }; return slots[i].fn; },
  };
  const Studio = load('app/dashboard/DancerTvStudio.tsx', {
    react: hooks,
    '@/src/lib/dancr/media-review-label': mediaReview,
    '@/src/lib/dancr/video-processing-state': { isVideoProcessingStalled },
    '@/src/lib/dancr/media-limits': { MAX_DANCER_PROFILE_VIDEOS: 50 },
    './DancerPendingMediaGrid': { default: 'PendingGrid' },
    './DancerUploadFeedback': { DancerUploadSummary: 'Summary', DancerUploadProgress: 'Progress', usePendingUploadNotice() {} },
    './media-upload-feedback': { mediaBatchSummary, mediaUploadError },
    './dancer-profile-media-sync': { announceDancerProfileVideosChanged() {} },
    './dashboard-session': {
      readDashboardAccessToken: () => 'fixture',
      requestDancerTvVideosJson: async () => ({ profile: {}, videos: rows, maxVideos: 50, remainingVideoSlots: 50 - rows.length }),
      requestDancerTvVideoJson: async (id, options) => { calls.push([id, options.method]); rows = rows.filter(row => row.id !== id); return {}; },
    },
  }, { URL, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: { confirm: () => true, setInterval() { return 1; }, clearInterval() {} } });
  const props = { embedded: true, uploadOnly: true };
  function draw() {
    for (let pass = 0; dirty && pass < 20; pass++) {
      dirty = false; cursor = 0; tree = Studio(props); effects.splice(0).forEach(fn => fn());
    }
    assert.equal(dirty, false); return walk(tree);
  }
  draw();
  return { calls, get pending() { return draw().find(node => node.type === 'PendingGrid').props.items; },
    get active() { return draw().filter(node => node.props.className?.includes('dancer-upload-review-card')); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); draw(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('video grid contains saved pending reviews while incomplete and failed processing retain their controls', async () => {
  const f = videoFixture([
    { id: 'club', status: 'submitted', moderationDetails: { fileChecksPassed: true }, videoUrl: '/club.mp4' },
    { id: 'staff', status: 'submitted', clubReviewedAt: '2026-10-22', videoUrl: '/staff.mp4' },
    { id: 'incomplete', status: 'uploading' },
    { id: 'processing-error', status: 'submitted', moderationDetails: { fileChecksPassed: false }, videoUrl: '/processing.mp4' },
    { id: 'approved', status: 'approved' },
  ]);
  try {
    await f.settle();
    assert.deepEqual(Array.from(f.pending, item => item.id), ['club', 'staff']);
    assert.equal(f.active.length, 2);
    const previews = f.active.map(card => walk(card).find(node => node.type === './DancerVideoPreview'));
    assert.ok(previews.every(Boolean), 'processing cards also offer video playback');
    assert.equal(previews[1].props.videoUrl, '/processing.mp4');
    assert.equal(previews[1].props.label, 'Video 4');
    f.pending[1].onRemove(); await f.settle();
    assert.deepEqual(f.calls, [['staff', 'DELETE']]);
    assert.deepEqual(Array.from(f.pending, item => item.id), ['club']);
    assert.equal(f.active.length, 2);
  } finally { f.unmount(); }
});
