import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/dashboard/VenueApprovalsPanel.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Component events only, with in-memory hooks and a hash event stub.
function harness(hash = '') {
  const slots = [], listeners = new Map(), focused = [], exports = {};
  let cursor = 0, dirty = true, effects = [], tree;
  const props = { venueId: 'club', active: true, refreshKey: 'initial', onCountChange() {} };
  const window = { location: { hash }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const hooks = {
    useState(initial) { const i = cursor++; slots[i] ||= { value: initial }; return [slots[i].value, next => {
      const value = typeof next === 'function' ? next(slots[i].value) : next;
      if (value !== slots[i].value) { slots[i].value = value; dirty = true; }
    }]; },
    useCallback(callback) { const i = cursor++; slots[i] ||= { value: callback }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) {
      effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    } },
  };
  vm.runInNewContext(code, { exports, window, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === './VenueDancerApprovalPanel') return { default: 'NewDancers' };
    if (name === './VenueMediaReviewPanel') return { default: 'MediaUpdates' };
    if (name.endsWith('.css')) return {};
    throw Error(name);
  } });
  function render(next) {
    if (next) { Object.assign(props, next); dirty = true; }
    for (let i = 0; dirty && i < 20; i++) { dirty = false; cursor = 0; effects = []; tree = exports.default(props); effects.forEach(fn => fn()); }
    assert.equal(dirty, false);
  }
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  const find = id => nodes().find(node => node.props.id === id);
  render();
  return { render, nodes, focused, find,
    child: type => nodes().find(node => node.type === type),
    click(id) { find(`venue-approvals-tab-${id}`).props.onClick(); render(); },
    hash(value) { window.location.hash = value; listeners.get('hashchange')(); render(); },
    key(id, key) { let prevented = false; find(`venue-approvals-tab-${id}`).props.onKeyDown({ key, preventDefault() { prevented = true; }, currentTarget: {
      parentElement: { querySelector: selector => ({ focus: () => focused.push(selector) }) },
    } }); render(); return prevented; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); assert.equal(listeners.size, 0); },
  };
}

test('one approvals section keeps both child reviews mounted and activates only the selected tab', () => {
  const ui = harness();
  assert.equal(ui.nodes().filter(node => node.type === 'h2' && node.props.children === 'Approvals').length, 1);
  assert.equal(ui.find('venue-approvals-panel-dancers').props.hidden, false);
  assert.equal(ui.find('venue-approvals-panel-media').props.hidden, true);
  assert.equal(ui.child('NewDancers').props.active, true);
  assert.equal(ui.child('MediaUpdates').props.active, false);
  assert.equal(ui.child('MediaUpdates').props.updatesOnly, true);
  const onDecision = ui.child('NewDancers').props.onDecision;
  ui.click('media');
  assert.equal(ui.find('venue-approvals-panel-dancers').props.hidden, true);
  assert.equal(ui.find('venue-approvals-panel-media').props.hidden, false);
  assert.equal(ui.child('NewDancers').props.active, false);
  assert.equal(ui.child('NewDancers').props.onDecision, onDecision);
  assert.equal(ui.child('MediaUpdates').props.active, true);
  ui.render({ active: false });
  assert.equal(ui.child('NewDancers').props.active, false);
  assert.equal(ui.child('MediaUpdates').props.active, false);
  ui.unmount();
});

test('existing notification links select the corresponding review tab on load and hash changes', () => {
  const ui = harness('#venue-media-reviews');
  assert.equal(ui.child('MediaUpdates').props.active, true);
  ui.hash('#venue-dancer-approvals');
  assert.equal(ui.child('NewDancers').props.active, true);
  ui.hash('#venue-media-reviews'); ui.hash('#table-requests');
  assert.equal(ui.find('venue-approvals-tab-media').props['aria-selected'], true);
  ui.hash('#venue-approvals');
  assert.equal(ui.find('venue-approvals-tab-dancers').props['aria-selected'], true);
  ui.unmount();
});

test('approval tabs support arrow keys, Home and End with one focusable tab', () => {
  const ui = harness();
  assert.equal(ui.key('dancers', 'ArrowRight'), true);
  assert.equal(ui.find('venue-approvals-tab-media').props.tabIndex, 0);
  assert.equal(ui.find('venue-approvals-tab-dancers').props.tabIndex, -1);
  assert.equal(ui.focused.at(-1), '#venue-approvals-tab-media');
  ui.key('media', 'Home');
  assert.equal(ui.child('NewDancers').props.active, true);
  ui.key('dancers', 'End'); ui.key('media', 'ArrowLeft');
  assert.equal(ui.child('NewDancers').props.active, true);
  assert.equal(ui.key('dancers', 'Enter'), false);
  ui.unmount();
});

test('completing a club join refreshes the separate media updates queue', () => {
  const ui = harness();
  const before = ui.child('MediaUpdates').props.refreshKey;
  ui.child('NewDancers').props.onDecision(); ui.render();
  assert.notEqual(ui.child('MediaUpdates').props.refreshKey, before);
  assert.equal(ui.child('NewDancers').props.refreshKey, ui.child('MediaUpdates').props.refreshKey);
  ui.unmount();
});
