import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/dashboard/VenueMediaReviewPanel.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Exercise the component's real handlers with in-memory requests; no browser journeys.
function harness(kind = 'photo') {
  let rows = ['first', 'second'].map(id => ({ id, kind, stageName: id, version: '2026-10-22T00:00:00Z',
    previewUrl: '/private-preview', label: kind, processing: false, canApprove: true, reasons: [], aiSummary: 'AI checks passed' }));
  let cursor = 0, dirty = true, effects = [], tree, failure = false, finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const slots = [], calls = [], focused = [], scrolled = [], counts = [];
  const changed = (a, b) => !a || b.some((value, i) => !Object.is(value, a[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (changed(previous?.deps, deps)) effects.push(() => {
      previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, Error, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === './dashboard-session') return { requestDashboardJson: async (_url, options) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); calls.push(body); await pending;
        if (failure) throw new Error('Unable to save rejection. Try again.');
        rows = rows.filter(row => row.id !== body.id); return { ok: true };
      }
      return { venueId: 'venue', count: rows.length, items: [...rows] };
    } };
    return { default: name };
  } });
  const props = { venueId: 'venue', active: true, onCountChange: count => counts.push(count) };
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  function render() {
    for (let i = 0; dirty && i < 25; i++) {
      dirty = false; cursor = 0; effects = []; tree = exports.default(props);
      nodes().filter(node => node.type === 'textarea').forEach(node => {
        const id = node.props['aria-describedby'].split(' ')[0].replace('review-note-hint-', '');
        node.props.ref({ focus: () => focused.push(id), scrollIntoView: options => scrolled.push([id, options.block]) });
      });
      effects.forEach(effect => effect());
    }
    assert.equal(dirty, false);
  }
  const ui = {
    calls, focused, scrolled, counts, finish,
    get cards() { return nodes().filter(node => node.type === 'article'); },
    field(index = 0) { return nodes(this.cards[index]).find(node => node.type === 'textarea'); },
    alerts(index = 0) { return nodes(this.cards[index]).filter(node => node.props?.role === 'alert'); },
    buttons(index = 0) { return nodes(this.cards[index]).filter(node => node.type === 'button'); },
    note(value, index = 0) { this.field(index).props.onChange({ target: { value } }); render(); },
    click(label = 'Reject', index = 0) { const button = this.buttons(index).find(node => node.props.children === label); assert.ok(button); assert.equal(button.props.disabled, false); button.props.onClick(); render(); },
    fail(value) { failure = value; },
    async settle() { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
  };
  render(); return ui;
}

for (const kind of ['photo', 'video']) {
  test(`${kind}: Reject with a missing or short reason focuses that card and shows an inline alert`, async () => {
    const ui = harness(kind); await ui.settle();
    for (const note of ['', '  ', 'no']) {
      ui.note(note, 1); ui.click('Reject', 1);
      assert.match(ui.alerts(1)[0].props.children, /rejection reason.*3 characters/);
      assert.equal(ui.field(1).props['aria-invalid'], true);
      assert.ok(ui.field(1).props['aria-describedby'].includes(ui.alerts(1)[0].props.id));
      assert.equal(ui.alerts(0).length, 0); assert.equal(ui.calls.length, 0);
      assert.equal(ui.focused.at(-1), 'second'); assert.deepEqual(ui.scrolled.at(-1), ['second', 'center']);
    }
  });
  test(`${kind}: a valid reason rejects once, removes only that upload and updates the count`, async () => {
    const ui = harness(kind); await ui.settle(); ui.click(); ui.note('The photo contains a logo.');
    assert.equal(ui.alerts().length, 0); assert.equal(ui.field().props['aria-invalid'], undefined);
    const savedButton = ui.buttons().find(node => node.props.children === 'Reject');
    ui.click(); savedButton.props.onClick();
    assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].notes, 'The photo contains a logo.');
    assert.equal(ui.calls[0].kind, kind); assert.equal(ui.calls[0].decision, 'rejected');
    assert.ok(ui.buttons().some(node => node.props.children === 'Rejecting…' && node.props.disabled));
    ui.finish(); await ui.settle();
    assert.equal(ui.cards.length, 1); assert.equal(ui.counts.at(-1), 1);
  });
}

test('a failed save keeps the reason and displays the server error on the affected card, allowing retry', async () => {
  const ui = harness(); await ui.settle(); ui.note('Please upload a clearer photo.'); ui.fail(true); ui.click();
  ui.finish(); await ui.settle();
  assert.match(ui.alerts()[0].props.children, /Unable to save rejection/);
  assert.equal(ui.field().props.value, 'Please upload a clearer photo.'); assert.equal(ui.cards.length, 2);
  assert.equal(ui.alerts(1).length, 0);
  ui.fail(false); ui.click(); await ui.settle();
  assert.equal(ui.cards.length, 1); assert.equal(ui.calls.length, 2);
});

test('approval does not require a rejection reason', async () => {
  const ui = harness(); await ui.settle(); ui.click('Approve');
  assert.equal(ui.calls[0].decision, 'approved'); assert.equal(ui.calls[0].notes, '');
  ui.finish(); await ui.settle(); assert.equal(ui.cards.length, 1);
});
