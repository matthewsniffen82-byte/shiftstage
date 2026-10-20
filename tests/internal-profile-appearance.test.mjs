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

test('loading shows the homepage-style spinner and Loading profile, without a heading or placeholder photo', () => {
  const render = fixture();
  let closed = 0;
  const props = { profileId: 'one', profile: null, prewarm: true,
    loadingIdentity: { id: 'one', stageName: 'Bailey', photoUrl: 'https://example.invalid/bailey.jpg' }, onClose: () => closed++ };
  const tree = render(props);
  const loading = find(tree, element => element.props?.className === 'ir-profile-loading');
  const status = find(loading, element => element.props?.role === 'status');
  assert.equal(status.props.className, 'ir-profile-loading-status');
  const [spinner, label] = status.props.children;
  assert.equal(spinner.props.className, 'ir-profile-loading-spinner');
  assert.equal(spinner.props['aria-hidden'], 'true');
  assert.equal(label.props.children, 'Loading profile\u2026');
  assert.equal(find(loading, element => /^h[1-6]$/.test(element.type) || element.type === 'img'), undefined);
  assert.equal(tree.props['aria-label'], 'Bailey\u2019s full profile');
  const close = find(loading, element => element.type === 'button');
  const navigation = find(loading, element => element.props?.className === 'ir-profile-loading-nav');
  assert.equal(navigation.type, 'div', 'guest button positioning rules must not apply to the positioned wrapper');
  assert.equal(navigation.props.children, close);
  assert.deepEqual(Array.from(loading.props.children, element => element.props.className), ['ir-profile-loading-nav', 'ir-profile-loading-status']);
  assert.equal(close.props['aria-label'], 'Close dancer profile');
  assert.equal(close.props.title, 'Back');
  assert.equal(close.props.children.props['aria-hidden'], 'true');
  close.props.onClick();
  assert.equal(closed, 1);
  assert.doesNotMatch(JSON.stringify(loading), /Bailey|Dancer profile|Loading details|Requests tonight|Followers|Working now/);
  const viewer = find(tree, element => element.type === 'iframe');
  assert.equal(viewer.props.hidden, true);
  viewer.props.onReady();
  assert.equal(find(render(props), element => element.props?.className === 'ir-profile-loading'), undefined);
  assert.equal(find(render(props), element => element.type === 'iframe').props.hidden, false);
});

test('switching dancers hides the old profile and keeps the same simple guest loading status', () => {
  const render = fixture();
  const props = { profileId: 'one', profile: null, prewarm: true, onClose() {} };
  find(render(props), element => element.type === 'iframe').props.onReady();
  const tree = render({ ...props, profileId: 'two', token: 'table-token', loadingIdentity: { id: 'two', stageName: 'Star' } });
  assert.equal(find(tree, element => element.props?.role === 'status').props.children[1].props.children, 'Loading profile\u2026');
  assert.equal(find(tree, element => element.type === 'h2'), undefined);
  assert.equal(find(tree, element => element.type === 'img'), undefined);
  assert.equal(find(tree, element => element.props?.className === 'ir-profile-loading').props['data-audience'], 'guest');
  assert.equal(find(tree, element => element.type === 'iframe').props.hidden, true);
  assert.equal(find(render({ ...props, profileId: '' }), element => element.props?.className === 'ir-profile-loading'), undefined);
});

test('loading stays centered independently of shared button positioning, with a corner exit', () => {
  const css = postcss.parse(readFileSync('app/internal/internal.css', 'utf8'));
  const styles = selector => {
    const rules = [];
    css.walkRules(rule => { if (rule.selector === selector) rules.push(rule); });
    assert.equal(rules.length, 1, selector);
    return Object.fromEntries(rules[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  };
  const base = 'body dialog.ir-full-profile-dialog';
  const loading = styles(base + ' .ir-profile-loading');
  assert.equal(loading.display, 'grid');
  assert.equal(loading['place-items'], 'center');
  const navigation = styles(base + ' .ir-profile-loading-nav');
  assert.equal(navigation.position, 'absolute');
  assert.match(navigation.top, /safe-area-inset-top/);
  assert.match(navigation.left, /safe-area-inset-left/);
  const buttonSelector = 'html body.dancr-button-system dialog.ir-full-profile-dialog .ir-profile-loading-nav button.ir-profile-loading-close';
  const close = styles(buttonSelector);
  assert.equal(close.position, 'relative', 'relative buttons cannot shift the status out of its center');
  assert.equal(close.width, '44px');
  assert.equal(close.height, '44px');
  css.walkRules(buttonSelector, rule => {
    for (const property of ['padding', 'border', 'background', 'box-shadow', 'font-size']) {
      assert.equal(rule.nodes.find(node => node.prop === property).important, true, property + ' overrides global important button styles');
    }
  });
  const guest = base + ' .ir-profile-loading[data-audience="guest"]';
  assert.equal(styles(guest).background, '#0b0b0d');
  assert.equal(styles('html body.dancr-button-system dialog.ir-full-profile-dialog .ir-profile-loading[data-audience="guest"] .ir-profile-loading-nav button.ir-profile-loading-close:focus-visible')['outline-color'], '#d4d4d8');
});

test('profile spinner size, spacing and motion match homepage loading and respect reduced motion', () => {
  const profileCss = postcss.parse(readFileSync('app/internal/internal.css', 'utf8'));
  const homeCss = postcss.parse(readFileSync('src/live-shell/styles/override-styles-03-home-discovery-empty-action-is-secondary-hover-home-discovery-em.css', 'utf8'));
  const styles = (css, selector) => {
    const rules = [];
    css.walkRules(rule => { if (rule.parent.type === 'root' && rule.selectors.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, selector);
    return Object.fromEntries(rules[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  };
  const base = 'body dialog.ir-full-profile-dialog';
  const status = styles(profileCss, base + ' .ir-profile-loading-status');
  const homeStatus = styles(homeCss, '.home-discovery-loading.is-dancers');
  for (const property of ['display', 'align-items', 'justify-content', 'gap', 'color', 'font-size', 'line-height', 'text-align']) {
    assert.equal(status[property], homeStatus[property], property);
  }
  const spinner = styles(profileCss, base + ' .ir-profile-loading-spinner');
  const homeSpinner = styles(homeCss, '.home-discovery-loading-spinner');
  for (const property of ['box-sizing', 'flex', 'width', 'height', 'border', 'border-top-color', 'border-radius']) {
    assert.equal(spinner[property], homeSpinner[property], property);
  }
  assert.equal(spinner.animation.split(' ').slice(1).join(' '), homeSpinner.animation.split(' ').slice(1).join(' '));
  const reduced = [];
  profileCss.walkAtRules('media', rule => {
    if (rule.params.replaceAll(' ', '') !== '(prefers-reduced-motion:reduce)') return;
    rule.walkRules(base + ' .ir-profile-loading-spinner', rule => reduced.push(rule));
  });
  assert.equal(reduced.length, 1);
  assert.equal(reduced[0].nodes.find(node => node.prop === 'animation').value, 'none');
});
