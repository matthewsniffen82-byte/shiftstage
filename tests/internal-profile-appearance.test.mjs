import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const embedCss = postcss.parse(readFileSync('src/live-shell/styles/internal-profile-embed.css', 'utf8'));

test('staff and customer profiles inherit the normal full-profile surfaces and frame', () => {
  let overrides = 0;
  embedCss.walkRules(rule => {
    const skin = /::before$|::after$| > \.profile-featured-column$|\.profile-options-panel$| #profileBackdrop$| body(?:\[[^\]]+\])?$/.test(rule.selector);
    if (!skin || rule.selector.includes('data-venue-guest-color') || rule.selector.includes('data-internal-table-request') || rule.selector.includes('internal-request-sent-label')) return;
    if (!rule.nodes.some(node => ['background', 'box-shadow', 'border-left-color'].includes(node.prop))) return;
    for (const selector of rule.selectors) assert.ok(selector.includes('[data-internal-profile-audience="guest"]'), selector);
    overrides++;
  });
  assert.equal(overrides, 6, 'all internal surface/frame/menu overrides apply only to table guests');
});

const code = ts.transpileModule(readFileSync('app/internal/FullProfileDialog.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture() {
  const states = [], exports = {}, events = [];
  const dialog = { open: false, showModal() { this.open = true; events.push('show'); }, close() { this.open = false; events.push('close'); } };
  let index = 0, effect, previousDeps, changed;
  vm.runInNewContext(code, {
    exports,
    require: name => name === 'react' ? {
      useRef: () => ({ current: dialog }),
      useEffect(callback, deps) {
        if (!previousDeps || deps.some((dep, i) => dep !== previousDeps[i])) effect = callback;
        previousDeps = deps;
      },
      useState: initial => {
        const i = index++;
        if (!(i in states)) states[i] = initial;
        return [states[i], value => {
          const next = typeof value === 'function' ? value(states[i]) : value;
          if (next !== states[i]) { states[i] = next; changed = true; }
        }];
      },
    } : name === 'react/jsx-runtime' ? require(name) : { InternalFullProfile: 'iframe' },
  });
  return { dialog, events, render(props) {
    let tree, renders = 0;
    do {
      index = 0; changed = false; effect = undefined;
      tree = exports.ClubProfileDialog(props);
      effect?.();
      assert.ok(++renders < 10, 'dialog settles without a render loop');
    } while (changed);
    return tree;
  } };
}

function viewer(tree) { return tree.props.children; }

for (const audience of ['guest', 'staff', 'customer']) {
  test(`${audience} keeps the roster visible until its actual profile is ready`, () => {
    const f = fixture();
    let ready = 0;
    const props = { profileId: 'one', profile: audience === 'customer' ? null : { id: 'one', stage_name: 'Bailey' },
      token: audience === 'guest' ? 'table-token' : undefined,
      publicSlug: audience === 'customer' ? 'bailey' : undefined, prewarm: true,
      loadingIdentity: { id: 'one', stageName: 'Bailey', photoUrl: 'https://example.invalid/photo.jpg' },
      onReady: () => ready++, onClose() {} };
    const tree = f.render(props);
    assert.equal(f.dialog.open, false, 'loading cannot create a modal backdrop or block the roster');
    assert.equal(viewer(tree).type, 'iframe', 'the full viewer is the only dialog content');
    assert.equal(viewer(tree).props.hidden, true);
    assert.equal(tree.props['aria-label'], 'Bailey’s full profile');
    assert.doesNotMatch(JSON.stringify(tree), /Loading profile|ir-profile-loading|spinner/);
    viewer(tree).props.onReady();
    assert.equal(viewer(f.render(props)).props.hidden, false);
    assert.equal(f.dialog.open, true);
    assert.equal(ready, 1);
    assert.deepEqual(f.events, ['show']);
    f.render({ ...props, profile: props.profile && { ...props.profile, requestsTonight: 5 } });
    assert.deepEqual(f.events, ['show'], 'polling preserves the open profile and scroll position');
  });
}

test('switching dancers closes the old dialog until the new profile is ready', () => {
  const f = fixture(), props = { profileId: 'one', profile: null, prewarm: true, onClose() {} };
  viewer(f.render(props)).props.onReady(); f.render(props);
  const next = { ...props, profileId: 'two' };
  const pending = f.render(next);
  assert.equal(f.dialog.open, false);
  assert.equal(viewer(pending).props.hidden, true);
  viewer(pending).props.onReady(); f.render(next);
  assert.equal(f.dialog.open, true);
  assert.deepEqual(f.events, ['show', 'close', 'show']);
  const back = f.render(props);
  assert.equal(f.dialog.open, false, 'a previously viewed ID must still wait for current readiness');
  assert.equal(viewer(back).props.hidden, true);
});

test('closing or cancelling a pending selection cannot let a late result open a profile', () => {
  const f = fixture();
  let closed = 0, prevented = 0;
  const props = { profileId: 'one', profile: null, prewarm: true, onClose: () => closed++ };
  const pending = f.render(props);
  f.render({ ...props, profileId: '' });
  viewer(pending).props.onReady();
  const idle = f.render({ ...props, profileId: '' });
  assert.equal(f.dialog.open, false);
  assert.equal(viewer(idle).props.hidden, true);
  assert.deepEqual(f.events, []);
  const selected = f.render(props);
  viewer(selected).props.onReady();
  const opened = f.render(props);
  opened.props.onCancel({ preventDefault: () => prevented++ });
  assert.equal(closed, 1); assert.equal(prevented, 1);
  f.render({ ...props, profileId: '' });
  assert.equal(f.dialog.open, false);
});

test('failed loads stay on the roster and a retry uses a fresh hidden viewer', () => {
  const f = fixture();
  let errors = 0;
  const props = { profileId: 'one', profile: null, prewarm: true, onClose() {}, onError: () => errors++ };
  const pending = f.render(props);
  viewer(pending).props.onError();
  const retry = f.render(props);
  assert.equal(f.dialog.open, false);
  assert.equal(errors, 1);
  assert.notEqual(viewer(retry).key, viewer(pending).key);
  assert.equal(viewer(retry).props.hidden, true);
  viewer(retry).props.onReady(); f.render(props);
  assert.equal(f.dialog.open, true);
});

test('idle prewarming stays hidden without rendering a loading page', () => {
  const f = fixture();
  const props = { profile: null, onClose() {} };
  assert.equal(viewer(f.render(props)), null);
  const idle = f.render({ ...props, prewarm: true });
  assert.equal(viewer(idle).type, 'iframe');
  assert.equal(viewer(idle).props.hidden, true);
  assert.equal(f.dialog.open, false);
});
