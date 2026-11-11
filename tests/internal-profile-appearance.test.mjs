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
  const dialog = { open: false, querySelector: selector => selector === 'iframe' ? { focus: () => events.push('focus') } : null, showModal() { this.open = true; events.push('show'); }, close() { this.open = false; events.push('close'); } };
  let index = 0, effect, previousDeps, changed;
  vm.runInNewContext(code, {
    exports, document: { activeElement: null },
    require: name => name === 'react' ? {
      useRef: () => ({ current: dialog }),
      useLayoutEffect(callback, deps) {
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

function viewer(tree) { return tree.props.children[1]; }
function opening(tree) { return tree.props.children[0]; }

for (const audience of ['club preview', 'club dashboard', 'guest dashboard', 'VIP dashboard']) {
  test(`${audience} opens the selected card before the full profile is ready`, () => {
    const f = fixture();
    const identity = { id: 'one', stageName: 'Bailey', photoUrl: 'https://example.invalid/bailey.jpg' };
    const props = { profileId: identity.id, prewarm: true, profile: null, onClose() {} };
    if (audience === 'club preview') {
      props.token = 'table-token';
      props.profile = { id: identity.id, stage_name: identity.stageName, initialPhotoUrl: identity.photoUrl, summaryOnly: true };
    } else {
      props.loadingIdentity = identity;
      if (audience !== 'club dashboard') props.publicSlug = 'bailey';
      if (audience === 'VIP dashboard') props.vipVenueId = 'club';
    }
    const pending = f.render(props);
    assert.equal(f.dialog.open, true);
    assert.equal(pending.props['aria-label'], 'Bailey’s full profile');
    assert.equal(opening(pending).props['data-profile-layout'], 'portrait-details');
    assert.match(JSON.stringify(opening(pending)), /bailey\.jpg/);
    assert.equal(viewer(pending).props.hidden, true, 'previous frame content is hidden');
    viewer(pending).props.onReady();
    const full = f.render(props);
    assert.ok(!opening(full));
    assert.equal(viewer(full).props.hidden, false);
    assert.equal(viewer(full).key, viewer(pending).key);
    assert.deepEqual(f.events, ['show', 'focus']);
  });
}

test('switching dancers immediately replaces the visible identity and waits for matching details', () => {
  const f = fixture();
  const first = { profileId: 'one', profile: { id: 'one', stage_name: 'Old', initialPhotoUrl: '/old.jpg' }, prewarm: true, onClose() {} };
  viewer(f.render(first)).props.onReady(); f.render(first);
  const next = { ...first, profileId: 'two', loadingIdentity: { id: 'two', stageName: 'New' } };
  const pending = f.render(next);
  assert.equal(pending.props['aria-label'], 'New’s full profile');
  assert.doesNotMatch(JSON.stringify(opening(pending)), /old\.jpg/);
  assert.equal(viewer(pending).props.hidden, true);
  viewer(pending).props.onReady(); f.render(next);
  assert.equal(viewer(f.render(first)).props.hidden, true);
  assert.deepEqual(f.events, ['show', 'focus', 'focus']);
});

test('Back and Escape can dismiss a pending profile, and late readiness cannot reopen it', () => {
  const f = fixture();
  let closed = 0, prevented = 0;
  const props = { profileId: 'one', profile: null, loadingIdentity: { id: 'one', stageName: 'One' }, prewarm: true, onClose: () => closed++ };
  const pending = f.render(props);
  const header = opening(pending).props.children.find(node => node.type === 'header');
  header.props.children.props.children.props.onClick();
  f.render({ ...props, profileId: '' });
  viewer(pending).props.onReady();
  assert.equal(f.dialog.open, false);
  const idle = f.render({ ...props, profileId: '' });
  assert.equal(viewer(idle).props.hidden, true);
  assert.ok(!opening(idle));
  f.render(props).props.onCancel({ preventDefault: () => prevented++ });
  assert.equal(closed, 2); assert.equal(prevented, 1);
});

test('a failed load returns to the dashboard and a retry uses a fresh frame', () => {
  const f = fixture();
  let id = 'one';
  const props = () => ({ profileId: id, profile: null, prewarm: true, onClose() {}, onError: () => { id = ''; } });
  const pending = f.render(props());
  viewer(pending).props.onError();
  assert.ok(!opening(f.render(props())));
  assert.equal(f.dialog.open, false);
  id = 'one';
  const retry = f.render(props());
  assert.equal(f.dialog.open, true);
  assert.notEqual(viewer(retry).key, viewer(pending).key);
  assert.equal(viewer(retry).props.hidden, true);
});

test('idle prewarming keeps the roster visible', () => {
  const f = fixture();
  const props = { profile: null, onClose() {} };
  assert.equal(viewer(f.render(props)), null);
  const idle = f.render({ ...props, prewarm: true });
  assert.equal(viewer(idle).type, 'iframe');
  assert.equal(viewer(idle).props.hidden, true);
  assert.ok(!opening(idle));
  assert.equal(f.dialog.open, false);
});
