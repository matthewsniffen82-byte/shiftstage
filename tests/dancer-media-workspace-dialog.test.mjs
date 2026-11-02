import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as statuses from '../src/lib/dancr/club-media-status.ts';

const require = createRequire(import.meta.url);
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
function fixture() {
  const exports = {}, calls = [], refs = [], effects = [], document = { body: { style: { overflow: 'auto' } }, activeElement: { isConnected: true, focus: () => calls.push('focus') } };
  let cursor = 0, lastOpen, cleanup;
  vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerMediaEditor.tsx','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, document, require: name => name === 'react' ? {
      useRef: value => refs[cursor++] ||= { current: value },
      useEffect(fn, deps) { if (deps[0] !== lastOpen) { lastOpen = deps[0]; effects.push(() => { cleanup?.(); cleanup = fn(); }); } },
    } : name.endsWith('.css') ? {} : name === './DancerMediaUploadRules' ? { default: 'UploadRules' } : require(name),
  });
  const props = { open: true, kind: 'photos', busy: false, onKindChange: kind => { props.kind = kind; }, onClose: () => calls.push('close'),
    children: React.createElement('input', { type: 'file' }), footer: React.createElement('button', null, 'Submit for approval') };
  const element = { open: false, showModal() { this.open = true; calls.push('show'); }, close() { this.open = false; }, querySelector: () => ({ focus() {} }) };
  function draw() { cursor = 0; const tree = exports.default(props); tree.props.ref.current = element; effects.splice(0).forEach(fn => fn()); return walk(tree); }
  return { props, calls, document, element, draw, unmount: () => cleanup?.() };
}

test('the upload grid switches photos and videos with their rules without remounting uploads', () => {
  const f = fixture(); let nodes = f.draw();
  const upload = nodes.find(n => n.type === 'input');
  assert.equal(nodes.find(n => n.type === 'h3').props.children, 'My Photos');
  assert.equal(nodes.find(n => n.type === 'UploadRules').props.kind, 'photo');
  const content = nodes.find(n => n.props.className === 'dancer-media-library-content');
  assert.ok(React.Children.toArray(content.props.children).some(n => n.type === 'UploadRules'), 'rules stay visible above the grid');
  assert.equal(nodes.some(n => n.props.className === 'dancer-media-editor-filters'), false);
  nodes.find(n => n.props.role === 'tab' && n.props.id === 'media-tab-videos').props.onClick();
  nodes = f.draw(); assert.equal(nodes.find(n => n.props.id === 'media-tab-videos').props['aria-selected'], true);
  assert.equal(nodes.find(n => n.type === 'h3').props.children, 'My Videos');
  assert.equal(nodes.find(n => n.type === 'UploadRules').props.kind, 'video');
  assert.equal(nodes.find(n => n.type === 'input').props, upload.props); assert.deepEqual(f.calls, ['show']);
  assert.equal(f.element.open, true);
  assert.equal(f.document.body.style.overflow, 'hidden');
  f.props.open = false; f.draw(); assert.equal(f.element.open, false); assert.equal(f.document.body.style.overflow, 'auto');
  assert.ok(f.calls.includes('focus')); f.unmount();
});

test('escape respects busy uploads and nested crop dialogs do not close My Media', () => {
  const f = fixture(); let root = f.draw()[0]; let prevented = 0;
  root.props.onCancel({ target: {}, currentTarget: {}, preventDefault() { prevented++; } }); assert.equal(prevented, 0);
  const target = {}; f.props.busy = true; root = f.draw()[0];
  root.props.onCancel({ target, currentTarget: target, preventDefault() { prevented++; } }); assert.equal(prevented, 1); assert.ok(!f.calls.includes('close'));
  f.props.busy = false; root = f.draw()[0]; root.props.onCancel({ target, currentTarget: target, preventDefault() {} }); assert.ok(f.calls.includes('close')); f.unmount();
});

test('draft, pending, approved and failed filters use the selected club decision', () => {
  const item = { id: 'one', status: 'pending' };
  const state = { selectedClub: { id: 'a', name: 'A' }, error: '', statuses: [
    { id: 'one', venueId: 'a', kind: 'photo', status: 'pending', submissionState: 'draft' },
    { id: 'one', venueId: 'b', kind: 'photo', status: 'rejected', submissionState: 'needs_changes' },
  ] };
  assert.equal(statuses.mediaLibraryStatus(item, state, 'photo'), 'draft');
  assert.equal(statuses.mediaLibraryStatus(item, { ...state, selectedClub: { id: 'b' } }, 'photo'), 'needs_changes');
  state.statuses[0].submissionState = 'pending'; assert.equal(statuses.mediaLibraryStatus(item, state, 'photo'), 'pending');
  state.statuses[0].submissionState = 'approved'; assert.equal(statuses.mediaLibraryStatus({ ...item, status: 'approved' }, state, 'photo'), 'approved');
  assert.equal(statuses.mediaLibraryStatus({ ...item, upload: { label: 'Failed', error: 'Connection lost' } }, state, 'photo'), 'needs_changes');
});
