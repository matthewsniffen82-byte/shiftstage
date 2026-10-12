import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('app/dashboard/DancerRejectedUploadNotice.tsx', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness(kind = 'photo', response) {
  const slots = [], timers = new Map(), events = new Map(), calls = [], exports = {};
  let cursor = 0, effects = [], dirty = true, tree, now = 0, observer;
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const props = { id: 'rejected-id', kind, label: 'Selected upload', message: 'Remove the contact overlay.', onDismiss: () => calls.push(['dismissed']) };
  const changed = (a, b) => !a || b.some((dep, i) => !Object.is(dep, a[i]));
  const hooks = {
    useState(initial) { const i = cursor++; slots[i] ||= { value: initial }; slots[i].set ||= next => {
      const value = typeof next === 'function' ? next(slots[i].value) : next;
      if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
    }; return [slots[i].value, slots[i].set]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (changed(old?.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useCallback(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
  };
  const request = async (...args) => { calls.push(args); return response ? response(...args) : { dismissedId: props.id }; };
  vm.runInNewContext(code, { exports, AbortController, document,
    IntersectionObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} },
    window: { setTimeout: (fn, delay) => { const key = {}; timers.set(key, { fn, at: now + delay }); return key; }, clearTimeout: key => timers.delete(key) },
    require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      : name === './dashboard-session' ? { requestDancerPhotosJson: request, requestDancerTvVideoJson: request } : {},
  });
  function render() { for (let n = 0; dirty && n < 20; n++) { dirty = false; cursor = 0; effects = []; tree = exports.default(props); if (tree) tree.props.ref.current = {}; effects.forEach(fn => fn()); } assert.equal(dirty, false); }
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props.children].flat(Infinity).flatMap(nodes)];
  const ui = {
    calls, timers, get tree() { return tree; },
    visible(value) { observer([{ isIntersecting: value }]); render(); },
    tabVisible(value) { document.visibilityState = value ? 'visible' : 'hidden'; events.get('visibilitychange')(); render(); },
    busy(value) { props.disabled = value; dirty = true; render(); },
    hover(value) { tree.props[value ? 'onMouseEnter' : 'onMouseLeave'](); render(); },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await this.settle(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
    retry() { nodes(tree).find(node => node.type === 'button').props.onClick(); render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  render(); return ui;
}

for (const kind of ['photo', 'video']) test(`${kind} shows the reason, then clears only the rejected ID after ten visible seconds`, async () => {
  const ui = harness(kind);
  assert.equal(ui.tree.props.role, 'status');
  assert.equal(ui.tree.props.children[1].props.children, 'Remove the contact overlay.');
  await ui.advance(20_000); assert.equal(ui.calls.length, 0, 'offscreen is not reading time');
  ui.visible(true); await ui.advance(9_999); assert.equal(ui.calls.length, 0);
  await ui.advance(1); assert.equal(ui.tree, null);
  const options = ui.calls[0].at(-1);
  assert.equal(options.method, 'PATCH'); assert.equal(JSON.parse(options.body).action, 'dismiss-rejected');
  if (kind === 'photo') assert.equal(JSON.parse(options.body).photoId, 'rejected-id');
  else assert.equal(ui.calls[0][0], 'rejected-id');
  assert.deepEqual(ui.calls.at(-1), ['dismissed']);
});

test('background tabs, busy uploads and pointer reading pause the notice', async () => {
  const ui = harness(); ui.visible(true); await ui.advance(5_000); ui.tabVisible(false);
  await ui.advance(20_000); assert.equal(ui.calls.length, 0);
  ui.tabVisible(true); ui.busy(true); await ui.advance(20_000); assert.equal(ui.calls.length, 0);
  ui.busy(false); ui.hover(true); await ui.advance(20_000); assert.equal(ui.calls.length, 0);
  ui.hover(false); await ui.advance(10_000); assert.equal(ui.tree, null);
});

for (const failure of ['network', 'unconfirmed']) test(`${failure} keeps the reason and offers one explicit retry without a request loop`, async () => {
  let count = 0;
  const ui = harness('photo', async () => { if (++count === 1) { if (failure === 'network') throw new Error('offline'); return {}; } return { dismissedId: 'rejected-id' }; });
  ui.visible(true); await ui.advance(10_000); assert.ok(ui.tree); assert.equal(count, 1);
  await ui.advance(60_000); assert.equal(count, 1);
  ui.retry(); await ui.settle(); assert.equal(ui.tree, null); assert.equal(count, 2);
});

test('unmount cancels the timer and ignores an in-flight cleanup response', async () => {
  const closed = harness(); closed.visible(true); closed.close(); await closed.advance(10_000); assert.equal(closed.calls.length, 0);
  let finish;
  const pending = harness('photo', () => new Promise(resolve => { finish = resolve; }));
  pending.visible(true); await pending.advance(10_000); const signal = pending.calls[0][0].signal;
  pending.close(); assert.equal(signal.aborted, true); finish({ dismissedId: 'rejected-id' }); await pending.settle();
  assert.ok(!pending.calls.some(call => call[0] === 'dismissed'));
});
