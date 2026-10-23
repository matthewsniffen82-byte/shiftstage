import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import ts from 'typescript';
import postcss from 'postcss';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/dashboard/DancerVideoPreview.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(initial = {}) {
  let playing = null;
  let props = { label: 'Video 2', videoUrl: '/pending.mp4?token=first', posterUrl: '/poster.jpg', ...initial };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name === 'react'
    ? { useState: () => [playing, value => { playing = value; }] }
    : name === 'react/jsx-runtime' ? require(name) : { default: name } });
  const nodes = () => React.Children.toArray(exports.default(props).props.children);
  return {
    get button() { return nodes().find(node => node.type === 'button'); },
    get viewer() { return nodes().find(node => node.type === './DancerMediaViewer'); },
    update(next) { props = { ...props, ...next }; },
  };
}

test('a pending upload opens its own playable preview only when tapped and can close and reopen', () => {
  const ui = fixture({ videoUrl: 'blob:local-upload' });
  assert.equal(ui.viewer, undefined);
  assert.equal(ui.button.props.type, 'button');
  assert.equal(ui.button.props['aria-label'], 'Play video 2');
  assert.equal(ui.button.props.disabled, false);
  ui.button.props.onClick();
  assert.equal(ui.viewer.props.kind, 'video');
  assert.equal(ui.viewer.props.videoUrl, 'blob:local-upload');
  assert.equal(ui.viewer.props.imageUrl, '/poster.jpg');
  ui.viewer.props.onClose();
  assert.equal(ui.viewer, undefined);
  ui.button.props.onClick();
  assert.equal(ui.viewer.props.videoUrl, 'blob:local-upload');
});

test('polling does not restart playback and reopening uses the latest private preview URL', () => {
  const ui = fixture();
  ui.button.props.onClick();
  ui.update({ videoUrl: '/pending.mp4?token=renewed', posterUrl: '/poster.jpg?token=renewed' });
  assert.equal(ui.viewer.props.videoUrl, '/pending.mp4?token=first');
  assert.equal(ui.viewer.props.imageUrl, '/poster.jpg');
  ui.viewer.props.onClose();
  ui.button.props.onClick();
  assert.equal(ui.viewer.props.videoUrl, '/pending.mp4?token=renewed');
  assert.equal(ui.viewer.props.imageUrl, '/poster.jpg?token=renewed');
});

test('missing sources and removal in progress cannot open an empty player', () => {
  for (const props of [{ videoUrl: null }, { videoUrl: '' }, { disabled: true }]) {
    const ui = fixture(props);
    assert.equal(ui.button.props.disabled, true);
    ui.button.props.onClick();
    assert.equal(ui.viewer, undefined);
  }
  const ui = fixture({ videoUrl: null });
  ui.update({ videoUrl: '/ready.mp4' });
  assert.equal(ui.button.props.disabled, false);
  ui.button.props.onClick();
  assert.equal(ui.viewer.props.videoUrl, '/ready.mp4');
});

test('play controls overlay the existing card without changing its sizing or covering the thumbnail', () => {
  const css = postcss.parse(readFileSync('app/dashboard/dancer-video-preview.css', 'utf8'));
  const rules = [];
  css.walkRules(rule => rules.push(rule));
  const control = rules.find(rule => rule.selector.includes('html body.dancr-button-system button.dancer-video-preview-open'));
  assert.equal(control.parent.params, 'dancr-palette', 'the shared dashboard palette must not paint over the thumbnail');
  const declarations = Object.fromEntries(control.nodes.map(node => [node.prop, node.value]));
  assert.equal(declarations.position, 'absolute');
  assert.equal(declarations.inset, '0');
  assert.equal(declarations.width, '100%');
  assert.equal(declarations.height, '100%');
  assert.equal(declarations.background, 'transparent');
  assert.equal(declarations['backdrop-filter'], 'none');
  assert.equal(declarations['-webkit-backdrop-filter'], 'none');
  assert.equal(declarations.padding, '0');
  assert.ok(rules.some(rule => rule.selector.includes(':focus-visible')));
});
