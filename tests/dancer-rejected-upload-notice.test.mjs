import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as labels from '../src/lib/dancr/media-review-label.ts';
const code = ts.transpileModule(readFileSync('app/dashboard/DancerRejectedUploadNotice.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function harness(kind = 'photo', { localOnly = false, response } = {}) {
  const slots = [], calls = [], exports = {};
  let cursor = 0, effects = [], dirty = true, tree;
  const props = { id: 'rejected-id', kind, label: 'Selected upload', message: 'Club A: Logo visible', localOnly, onDismiss: () => calls.push('dismissed') };
  const changed = (a, b) => !a || b.some((dep, i) => !Object.is(dep, a[i]));
  const request = async (...args) => { calls.push(args); return response ? response(...args) : { dismissedId: props.id }; };
  vm.runInNewContext(code, { exports, AbortController,
    window: { setTimeout() { throw new Error('Rejected uploads must never expire automatically'); } },
    require: name => name === 'react' ? {
      useState(initial) { const i = cursor++; slots[i] ||= { value: initial }; return [slots[i].value, value => { slots[i].value = value; dirty = true; }]; },
      useRef(initial) { return slots[cursor++] ||= { current: initial }; },
      useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (changed(old?.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
      useCallback(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    } : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      : name === './dashboard-session' ? { requestDancerPhotosJson: request, requestDancerTvVideoJson: request }
      : name === '@/src/lib/dancr/media-review-label' ? labels : {},
  });
  function render() { for (let n = 0; dirty && n < 20; n++) { dirty = false; cursor = 0; effects = []; tree = exports.default(props); effects.forEach(fn => fn()); } assert.equal(dirty, false); }
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props.children].flat(Infinity).flatMap(nodes)];
  const ui = { calls, get tree() { return tree; }, draw() { dirty = true; render(); },
    text() { return nodes(tree).flatMap(node => [node.props.children].flat(Infinity).filter(item => typeof item === 'string')).join(' '); },
    remove() { nodes(tree).find(node => node.type === 'button').props.onClick(); render(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  render(); return ui;
}
for (const kind of ['photo', 'video']) test(`${kind} stays visible until explicit removal, with simple feedback and no reviewer`, async () => {
  const ui = harness(kind); for (let i = 0; i < 20; i++) ui.draw(); await ui.settle();
  assert.equal(ui.calls.length, 0);
  assert.match(ui.text(), new RegExp(`Not approved — choose another ${kind === 'photo' ? 'picture' : 'video'}`));
  assert.doesNotMatch(ui.text(), /Club A|Logo visible/);
  ui.remove(); await ui.settle(); assert.equal(ui.tree, null);
  assert.equal(JSON.parse(ui.calls[0].at(-1).body).action, 'dismiss-rejected');
  assert.equal(ui.calls.at(-1), 'dismissed');
});
test('failed removal keeps the rejected item and supports retry', async () => {
  let calls = 0;
  const ui = harness('photo', { response: async () => { if (!calls++) throw new Error('offline'); return { dismissedId: 'rejected-id' }; } });
  ui.remove(); await ui.settle(); assert.ok(ui.tree); assert.match(ui.text(), /Retry removal/);
  ui.draw(); await ui.settle(); assert.equal(calls, 1);
  ui.remove(); await ui.settle(); assert.equal(ui.tree, null);
});
test('a local rejected video is removed only on request without a server call', async () => {
  const ui = harness('video', { localOnly: true }); await ui.settle(); assert.equal(ui.calls.length, 0);
  ui.remove(); await ui.settle(); assert.deepEqual(ui.calls, ['dismissed']); assert.equal(ui.tree, null);
});
test('unmount aborts removal and does not dismiss an unconfirmed item', async () => {
  let finish;
  const ui = harness('photo', { response: () => new Promise(resolve => { finish = resolve; }) });
  ui.remove(); const signal = ui.calls[0][0].signal; ui.close(); assert.equal(signal.aborted, true);
  finish({ dismissedId: 'rejected-id' }); await ui.settle(); assert.ok(!ui.calls.includes('dismissed'));
});
