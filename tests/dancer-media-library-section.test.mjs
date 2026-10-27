import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';

const require = createRequire(import.meta.url);
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const code = ts.transpileModule(readFileSync('app/dashboard/DancerMediaLibrarySection.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function fixture(overrides = {}) {
  const exports = {}, refs = [], effects = [], calls = [], body = { style: { overflow: 'auto' } };
  let cursor = 0, cleanup, lastOpen;
  const props = { kind: 'photos', items: [], open: false, busy: false, onOpen: () => calls.push('open'), onClose: () => calls.push('close'), children: React.createElement('input', { type: 'file' }), ...overrides };
  vm.runInNewContext(code, { exports, document: { body }, require: name => name === 'react' ? {
    useRef: initial => refs[cursor++] ||= { current: initial },
    useEffect(fn, deps) { if (deps[0] !== lastOpen) { lastOpen = deps[0]; effects.push(() => { cleanup?.(); cleanup = fn(); }); } },
  } : name.endsWith('.css') ? {} : require(name) });
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

test('loading, empty, failure and overflowing libraries have distinct summaries', () => {
  assert.match(fixture({ kind: 'videos', loading: true }).draw().html, /Loading videos/);
  assert.match(fixture({ kind: 'videos', error: 'Offline' }).draw().html, /Videos unavailable/);
  assert.match(fixture({ kind: 'videos' }).draw().html, /Add videos to your profile/);
  const f = fixture({ items: Array.from({ length: 12 }, (_, i) => ({ id: String(i), imageUrl: '/photo.jpg', status: 'approved' })) });
  const { html } = f.draw();
  assert.match(html, /12 photos/); assert.match(html, /\+7<\/b>/);
  assert.match(html, /Edit photo 6 and 6 more/);
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
  assert.ok(rules.find(rule => rule.selector === '.dancer-media-library-strip').nodes.some(n => n.prop === 'grid-template-columns' && n.value === 'repeat(6,minmax(0,1fr))'));
  for (const name of ['dancer-media-slot-remove', 'dancer-media-library-done']) {
    assert.ok(rules.some(rule => rule.selector.includes(name) && rule.nodes.some(n => n.prop === 'min-height' && n.value === '44px')));
  }
  assert.match(readFileSync('app/dashboard/dancer-profile-builder.css', 'utf8'), /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
