import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import { mergeMediaLibraryItems } from '../app/dashboard/media-library-items.ts';

const require = createRequire(import.meta.url);
const previewContext = React.createContext(null);
const VideoThumbnail = ({ posterUrl, videoUrl }) => React.createElement(posterUrl ? 'img' : 'video', { src: posterUrl || videoUrl, alt: '' });
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const code = ts.transpileModule(readFileSync('app/dashboard/DancerMediaLibrarySection.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function fixture(overrides = {}) {
  const exports = {}, refs = [], effects = [], calls = [], body = { style: { overflow: 'auto' } };
  let cursor = 0, cleanup, lastOpen, snapshot = '[]';
  const publish = value => { snapshot = value; };
  const props = { kind: 'photos', items: [], open: false, busy: false, onOpen: () => calls.push('open'), onClose: () => calls.push('close'), children: React.createElement('input', { type: 'file' }), ...overrides };
  vm.runInNewContext(code, { exports, document: { body }, require: name => name === 'react' ? {
    useRef: initial => refs[cursor++] ||= { current: initial },
    useState: () => [snapshot, publish],
    useEffect(fn, deps) { if (deps[0] !== lastOpen) { lastOpen = deps[0]; effects.push(() => { cleanup?.(); cleanup = fn(); }); } },
  } : name === './DancerProfileUploadContext' ? { DancerMediaPreviewContext: previewContext }
    : name === './media-library-items' ? { mergeMediaLibraryItems }
    : name === './DancerVideoThumbnail' ? { default: VideoThumbnail }
    : name === '@/src/lib/dancr/media-limits' ? { MAX_DANCER_PROFILE_PHOTOS: 50, MAX_DANCER_PROFILE_VIDEOS: 50 } : name.endsWith('.css') ? {} : require(name) });
  const element = { open: false, showModal() { this.open = true; calls.push('show'); }, close() { this.open = false; calls.push('native-close'); } };
  function draw() {
    cursor = 0;
    const tree = exports.default(props), nodes = walk(tree);
    nodes.find(n => n.type === 'dialog').props.ref.current = element;
    nodes.find(n => n.props.className === 'dancer-media-library-edit').props.ref.current = { focus: () => calls.push('focus') };
    effects.splice(0).forEach(fn => fn());
    return { tree, nodes, html: renderToStaticMarkup(tree) };
  }
  return { props, calls, body, element, draw, unmount: () => cleanup?.() };
}

test('photos and videos each have six compact preview slots and a distinct editor', () => {
  for (const kind of ['photos', 'videos']) {
    const f = fixture({ kind, items: [{ id: 'a', imageUrl: '/one.jpg', status: 'approved' }, { id: 'b', imageUrl: '/two.jpg', status: 'submitted' }] });
    const { nodes, html } = f.draw();
    const strip = nodes.find(n => n.props.className === 'dancer-media-library-strip');
    assert.equal(walk(strip).filter(n => n.type === 'button').length, 6);
    assert.equal(walk(strip).filter(n => n.type === (kind === 'videos' ? VideoThumbnail : 'img')).length, 2);
    assert.equal(walk(strip).filter(n => n.type === 'span' && n.props.children === '+').length, 4);
    assert.doesNotMatch(renderToStaticMarkup(strip), /<i\b|<svg|<b\b|▶|▧/);
    walk(strip).find(n => n.type === 'button' && n.props['aria-label'] === `Add ${kind === 'photos' ? 'photo' : 'video'}`).props.onClick();
    assert.deepEqual(f.calls, ['open']); f.calls.length = 0;
    assert.match(html, new RegExp(kind === 'photos' ? 'My Photos' : 'My Videos'));
    assert.match(html, /2 (photos|videos) · 1 awaiting approval/);
    assert.doesNotMatch(html, /<video/);
    nodes.find(n => n.props.className === 'dancer-media-library-edit').props.onClick();
    assert.deepEqual(f.calls, ['open']);
    assert.equal(nodes.find(n => n.type === 'dialog').props['aria-labelledby'], `dancer-${kind}-editor-title`);
  }
});

test('opening and closing the dialog preserves the mounted uploader and restores scrolling', () => {
  const f = fixture();
  assert.equal(f.draw().nodes.filter(n => n.type === 'input').length, 1);
  f.props.open = true; f.draw();
  assert.equal(f.element.open, true); assert.equal(f.body.style.overflow, 'hidden');
  f.props.busy = true;
  let prevented = false;
  f.draw().nodes.find(n => n.type === 'dialog').props.onCancel({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.ok(!f.calls.includes('close'));
  assert.equal(f.draw().nodes.find(n => n.props.className === 'dancer-media-library-done').props.disabled, true);
  f.props.busy = false; f.props.open = false;
  assert.equal(f.draw().nodes.filter(n => n.type === 'input').length, 1);
  assert.equal(f.element.open, false); assert.equal(f.body.style.overflow, 'auto');
});

test('deactivating a photo or video editor releases the modal and scroll lock even during uploads', () => {
  for (const kind of ['photos', 'videos']) {
    const f = fixture({ kind, open: true, busy: true });
    f.draw();
    assert.equal(f.element.open, true);
    assert.equal(f.body.style.overflow, 'hidden');
    f.props.open = false;
    assert.equal(f.draw().nodes.filter(n => n.type === 'input').length, 1);
    assert.equal(f.element.open, false);
    assert.equal(f.body.style.overflow, 'auto');
    f.props.open = true; f.draw(); f.unmount();
    assert.equal(f.element.open, false);
    assert.equal(f.body.style.overflow, 'auto');
  }
});

test('loading, empty, failure and overflowing libraries have distinct summaries', () => {
  assert.match(fixture({ kind: 'videos', loading: true }).draw().html, /Loading videos/);
  assert.match(fixture({ kind: 'videos', error: 'Offline' }).draw().html, /Videos unavailable/);
  assert.match(fixture({ kind: 'videos' }).draw().html, /Add videos to your profile/);
  const f = fixture({ items: Array.from({ length: 12 }, (_, i) => ({ id: String(i), imageUrl: '/photo.jpg', status: 'approved' })) });
  const { html } = f.draw();
  assert.match(html, /12 photos/); assert.doesNotMatch(html, /dancer-media-library-more/);
  assert.match(html, /Edit photo 12/);
});

test('scrolling previews include every photo and video with an add slot until capacity', () => {
  for (const kind of ['photos', 'videos']) for (const count of [0, 5, 6, 7, 12, 50]) {
    const items = Array.from({ length: count }, (_, i) => ({ id: String(i), imageUrl: `/poster-${i}.jpg`, status: 'approved' }));
    const f = fixture({ kind, items });
    const strip = f.draw().nodes.find(n => n.props.className === 'dancer-media-library-strip');
    const nodes = walk(strip), buttons = nodes.filter(n => n.type === 'button');
    assert.deepEqual(nodes.filter(n => n.type === (kind === 'videos' ? VideoThumbnail : 'img')).map(n => kind === 'videos' ? n.props.posterUrl : n.props.src), items.map(item => item.imageUrl));
    assert.equal(buttons.length, Math.max(6, count + (count < 50 ? 1 : 0)));
    assert.equal(nodes.filter(n => n.type === 'span' && n.props.children === '+').length, buttons.length - count);
    if (count) {
      assert.equal(buttons[count - 1].props['aria-label'], `Edit ${kind === 'photos' ? 'photo' : 'video'} ${count}`);
      buttons[count - 1].props.onClick();
      assert.deepEqual(f.calls, ['open']);
    }
    f.props.busy = true;
    const busyStrip = f.draw().nodes.find(n => n.props.className === 'dancer-media-library-strip');
    assert.ok(walk(busyStrip).filter(n => n.type === 'button').every(n => n.props.disabled));
  }
});

test('local video frames fill the closed strip before the owner library responds and survive processing', () => {
  const f = fixture({ kind: 'videos', loading: true });
  const publish = items => f.draw().nodes.find(n => n.type === previewContext.Provider).props.value(JSON.stringify(items));
  const thumbnails = () => f.draw().nodes.filter(n => n.type === VideoThumbnail);
  publish([{ id: 'one', previewKey: 'one', videoUrl: 'blob:one', status: 'uploading' }]);
  assert.equal(thumbnails().length, 1);
  assert.equal(thumbnails()[0].props.videoUrl, 'blob:one');
  assert.match(f.draw().html, /1 video · 1 processing/);
  assert.doesNotMatch(f.draw().html, /Loading videos/);
  assert.equal(f.element.open, false);
  f.props.items = [{ id: 'one', videoUrl: '/private/one.mp4', imageUrl: '/poster.jpg', status: 'moderating' }];
  assert.equal(thumbnails().length, 1, 'the server receipt cannot duplicate the local upload');
  assert.equal(thumbnails()[0].props.posterUrl, undefined, 'keep the visible local frame until the uploader releases it');
  publish([]);
  assert.equal(thumbnails()[0].props.posterUrl, '/poster.jpg');
  assert.equal(thumbnails()[0].props.videoUrl, '/private/one.mp4');
});

test('processing videos without posters use their owner video URL and removed uploads stay absent', () => {
  const f = fixture({ kind: 'videos', items: [{ id: 'processing', status: 'moderating', videoUrl: '/private/video.mp4' }] });
  const publish = f.draw().nodes.find(n => n.type === previewContext.Provider).props.value;
  assert.equal(f.draw().nodes.find(n => n.type === VideoThumbnail).props.videoUrl, '/private/video.mp4');
  publish(JSON.stringify([{ id: 'processing', previewKey: 'local', status: 'moderating', videoUrl: 'blob:local' }]));
  f.props.removedIds = ['processing'];
  assert.equal(f.draw().nodes.filter(n => n.type === VideoThumbnail).length, 0);
  assert.match(f.draw().html, /Add videos to your profile/);
  f.props.removedIds = [];
  f.props.items = [{ id: 'failed', status: 'failed' }, { id: 'pending', status: 'submitted' }];
  publish('[]');
  assert.match(f.draw().html.replace(/<[^>]*>/g, ''), /2 videos · 1 awaiting approval · 1 need attention/);
});

test('photo and video summaries highlight declined items separately from pending approval', () => {
  for (const kind of ['photos', 'videos']) {
    const f = fixture({ kind, attentionIds: ['club-declined', 'platform-rejected'], items: [
      { id: 'club-declined', status: 'pending' }, { id: 'platform-rejected', status: 'rejected' },
      { id: 'pending', status: 'pending' }, { id: 'approved', status: 'approved' },
    ] });
    const { nodes, html } = f.draw();
    const highlighted = nodes.find(n => n.props.className === 'dancer-media-needs-attention');
    assert.equal(renderToStaticMarkup(highlighted).replace(/<[^>]*>/g, ''), ' · 2 need attention');
    assert.match(html.replace(/<[^>]*>/g, ''), /4 (photos|videos) · 1 awaiting approval · 2 need attention/);
    const strip = nodes.find(n => n.props.className === 'dancer-media-library-strip');
    assert.equal(walk(strip).some(n => n.props.className === 'dancer-media-needs-attention'), false);
    f.props.attentionIds = [];
    f.props.items = [{ id: 'replacement', status: 'pending' }, { id: 'approved', status: 'approved' }];
    assert.equal(f.draw().nodes.some(n => n.props.className === 'dancer-media-needs-attention'), false);
  }
});

test('completion uses a labeled checkmark and closing a source sheet does not close the editor', () => {
  const f = fixture({ open: true });
  const { nodes } = f.draw();
  const done = nodes.find(n => n.props.className === 'dancer-media-library-done');
  assert.equal(done.props['aria-label'], 'Done editing photos');
  assert.equal(walk(done).filter(n => n.type === 'svg').length, 1);
  assert.doesNotMatch(renderToStaticMarkup(done), />\s*Done\s*</);
  const dialog = nodes.find(n => n.type === 'dialog');
  dialog.props.onClose({ target: {}, currentTarget: f.element });
  dialog.props.onCancel({ target: {}, currentTarget: f.element, preventDefault() { throw Error('Child Escape must stay local'); } });
  assert.ok(!f.calls.includes('close'));
  done.props.onClick();
  assert.ok(f.calls.includes('close'));
});

test('pending cards already in the editor are deduplicated while new unsynced uploads remain visible', () => {
  const source = readFileSync('app/dashboard/DancerPendingMediaGrid.tsx', 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => name === 'react' ? { useContext: () => ({ libraryEditor: true, displayedMedia: { photos: ['known'], videos: ['video'] } }) }
      : name === 'react/jsx-runtime' ? require(name) : {},
  });
  const item = { kind: 'photo', label: 'Photo', imageUrl: '/p.jpg', onRemove() {} };
  const grid = exports.default({ items: [{ ...item, id: 'known' }, { ...item, id: 'new' }] });
  assert.equal(walk(grid).filter(n => n.type === 'li').length, 1);
  assert.equal(exports.default({ items: [{ ...item, id: 'known' }] }), null);
});

test('media strip and editor keep separate sizing and touch-sized controls', () => {
  const css = postcss.parse(readFileSync('app/dashboard/dancer-media-library.css', 'utf8'));
  const rules = [];
  css.walkRules(rule => rules.push(rule));
  const strip = rules.find(rule => rule.selector === '.dancer-media-library-strip');
  assert.ok(strip.nodes.some(n => n.prop === 'grid-auto-flow' && n.value === 'column'));
  assert.ok(strip.nodes.some(n => n.prop === 'overflow-x' && n.value === 'auto'));
  for (const name of ['dancer-media-slot-remove', 'dancer-media-library-done']) {
    assert.ok(rules.some(rule => rule.selector.includes(name) && rule.nodes.some(n => n.prop === 'min-height' && n.value === '44px')));
  }
  assert.match(readFileSync('app/dashboard/dancer-profile-builder.css', 'utf8'), /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
