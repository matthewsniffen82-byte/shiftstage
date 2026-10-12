import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/dashboard/DancerPhotoControls.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture({ disabled = false, options = true, compact = false } = {}) {
  let expanded = false, focused = false;
  let previousRequest;
  const exports = {}, primary = { type: 'button', props: { children: 'Change photo' } };
  const children = options ? { type: 'CropControl', props: {} } : null;
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return { useEffect: (effect, [request]) => { if (request !== previousRequest) { previousRequest = request; effect(); } }, useId: () => 'photo-options', useRef: () => ({ current: { focus: () => { focused = true; } } }), useState: () => [expanded, next => { expanded = typeof next === 'function' ? next(expanded) : next; }] };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    return {};
  } });
  const render = (openRequested = 0) => exports.default({ label: 'main photo', primary, children, disabled, compact, openRequested });
  return { render, children, primary, get focused() { return focused; } };
}

test('extra photo controls expand without unmounting crop state; the primary action stays visible', () => {
  const f = fixture();
  let tree = f.render(), [row, panel] = tree.props.children;
  assert.equal(row.props.children[0], f.primary);
  assert.equal(panel.props.hidden, true);
  assert.equal(panel.props.children, f.children);
  const toggle = row.props.children[1];
  assert.equal(toggle.props['aria-expanded'], false);
  assert.equal(toggle.props['aria-controls'], panel.props.id);
  assert.equal(toggle.props['aria-label'], 'More options for main photo');
  toggle.props.onClick();
  [row, panel] = f.render().props.children;
  assert.equal(panel.props.hidden, false);
  assert.equal(row.props.children[1].props['aria-expanded'], true);
  assert.equal(panel.props.children, f.children);
  row.props.children[1].props.onClick();
  assert.equal(f.render().props.children[1].props.hidden, true);
});

test('Escape closes photo options, keeps the editor open, and returns focus to the trigger', () => {
  const f = fixture();
  f.render().props.children[0].props.children[1].props.onClick();
  let prevented = false, stopped = false;
  f.render().props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(f.render().props.children[1].props.hidden, true);
  assert.ok(prevented && stopped && f.focused);
});

test('busy controls disable the toggle; empty photos do not show an empty options control', () => {
  assert.equal(fixture({ disabled: true }).render().props.children[0].props.children[1].props.disabled, true);
  const tree = fixture({ options: false }).render();
  assert.equal(tree.props.children[0].props.children[1], null);
  assert.equal(tree.props.children[1], null);
});

test('tapping a photo reveals its change and crop actions in the compact menu', () => {
  const f = fixture({ compact: true });
  const [row, panel] = f.render().props.children;
  assert.equal(row.props.children[0], null);
  assert.deepEqual(Array.from(panel.props.children.props.children), [f.primary, f.children]);
  f.render(1);
  assert.equal(f.render(1).props.children[1].props.hidden, false);
});
