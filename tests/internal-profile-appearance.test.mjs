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
  const states = [], exports = {};
  let index = 0;
  vm.runInNewContext(code, {
    exports,
    require: name => name === 'react' ? {
      useRef: () => ({ current: null }), useEffect() {},
      useState: initial => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    } : name === 'react/jsx-runtime' ? require(name) : { InternalFullProfile: 'iframe' },
  });
  return props => { index = 0; return exports.ClubProfileDialog(props); };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  return [tree.props?.children].flat().map(child => find(child, predicate)).find(Boolean);
}

test('opening shows the selected photo and name in the split card while details load, with a working close control', () => {
  const render = fixture();
  let closed = 0;
  const props = { profileId: 'one', profile: null, prewarm: true,
    loadingIdentity: { id: 'one', stageName: 'Bailey', photoUrl: 'https://example.invalid/bailey.jpg' }, onClose: () => closed++ };
  const tree = render(props);
  const card = find(tree, element => element.props?.className === 'ir-profile-loading-card');
  const [info, photo] = card.props.children;
  assert.equal(find(info, element => element.type === 'h2').props.children, 'Bailey');
  assert.equal(find(info, element => element.props?.role === 'status').props.children, 'Loading details…');
  assert.equal(find(photo, element => element.type === 'img').props.src, props.loadingIdentity.photoUrl);
  find(info, element => element.type === 'button').props.onClick();
  assert.equal(closed, 1);
  assert.doesNotMatch(JSON.stringify(card), /Requests tonight|Followers|Working now/, 'do not invent profile data while authorization is pending');
  const viewer = find(tree, element => element.type === 'iframe');
  assert.equal(viewer.props.hidden, true);
  viewer.props.onReady();
  assert.equal(find(render(props), element => element.props?.className === 'ir-profile-loading-card'), undefined);
  assert.equal(find(render(props), element => element.type === 'iframe').props.hidden, false);
});

test('switching to another dancer never leaves the previous identity in the loading card', () => {
  const render = fixture();
  const props = { profileId: 'one', profile: null, prewarm: true, onClose() {} };
  find(render(props), element => element.type === 'iframe').props.onReady();
  const tree = render({ ...props, profileId: 'two', token: 'table-token', loadingIdentity: { id: 'two', stageName: 'Star' } });
  assert.equal(find(tree, element => element.type === 'h2').props.children, 'Star');
  assert.equal(find(tree, element => element.type === 'img'), undefined);
  assert.equal(find(tree, element => element.props?.className === 'ir-profile-loading').props['data-audience'], 'guest');
  assert.equal(find(tree, element => element.type === 'iframe').props.hidden, true);
  assert.equal(find(render({ ...props, profileId: '' }), element => element.props?.className === 'ir-profile-loading'), undefined);
});
