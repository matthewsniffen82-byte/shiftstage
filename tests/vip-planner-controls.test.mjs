import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { compileVip, venues, dancers } from './helpers/vip-dashboard-fixture.mjs';
import * as helpers from '../src/lib/dancr/vip-dashboard.ts';
import * as types from '../src/lib/dancr/vip-types.ts';

const styles = file => postcss.parse(readFileSync(new URL('../app/vip/' + file, import.meta.url), 'utf8'));
const polish = styles('vip-dashboard-polish.css');
const premium = styles('vip-premium.css');
const library = styles('vip-my-dancers.css');
function rule(root, selector) {
  const matches = [];
  root.walkRules(selector, node => matches.push(node));
  assert.equal(matches.length, 1, selector);
  return matches[0];
}
const declarations = node => Object.fromEntries(node.nodes.filter(child => child.type === 'decl').map(child => [child.prop, child.value]));

test('only the iPhone mobile Visit details button gets the darker reference purple', () => {
  const selector = 'body.dancr-button-system #vip-dashboard .vip-mobile-continue button.vip-primary';
  const face = rule(polish, selector);
  assert.equal(face.parent.name, 'supports'); assert.equal(face.parent.params, '(-webkit-touch-callout: none)');
  assert.equal(face.parent.parent.name, 'media'); assert.equal(face.parent.parent.params, '(max-width: 880px)');
  assert.deepEqual(declarations(face), {
    background: 'linear-gradient(110deg, #3000a3, #210078)', 'border-color': '#513776', color: '#fff',
    'box-shadow': 'none', 'text-shadow': 'none',
  });
  assert.ok(face.nodes.every(node => node.important));
  assert.equal(declarations(rule(polish, selector + ':enabled')).filter, 'none');
  assert.equal(declarations(rule(polish, 'body.dancr-button-system #vip-dashboard button.vip-primary')).background, 'linear-gradient(110deg, #6b29cb, #4c16a2)');
  assert.match(declarations(rule(polish, 'body.dancr-button-system #vip-dashboard :is(button, a, input, select, textarea):focus-visible')).outline, /^2px solid/);
});

test('VIP add icons have an opaque dark fill over photos, with checked, focus and disabled states preserved', () => {
  for (const [root, selector] of [
    [premium, '.vip-dashboard-shell .vip-dancer-select svg'],
    [library, 'body.dancr-button-system #vip-dashboard .vip-library-request svg'],
  ]) {
    const icon = declarations(rule(root, selector));
    assert.equal(icon.fill, '#17111f'); assert.equal(icon.width, '21px'); assert.equal(icon.height, '21px');
    assert.equal(icon['stroke-width'], '1.7');
  }
  const selected = declarations(rule(premium, '.vip-dashboard-shell .vip-dancer-select input:checked + svg'));
  assert.equal(selected.fill, '#8a55cf'); assert.equal(selected.stroke, '#fff');
  assert.equal(declarations(rule(premium, '.vip-dashboard-shell .vip-dancer-select input:disabled + svg')).opacity, '.5');
  assert.match(declarations(rule(premium, '.vip-dashboard-shell .vip-dancer-select input:focus-visible + svg')).outline, /^2px solid/);
});

test('Visit details keeps its selection count, disabled state and accessible scroll/focus action', () => {
  const calls = [], target = { scrollIntoView: value => calls.push(['scroll', value]), focus: value => calls.push(['focus', value]) };
  let reducedMotion = false;
  const Planner = compileVip('app/vip/VipPlan.tsx', {
    react: { useState: initial => [initial, () => {}], useRef: () => ({ current: target }) },
    '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-dashboard': helpers,
  }, { window: { matchMedia: () => ({ matches: reducedMotion }) } }).default;
  const props = { venue: venues[0], dancers, draft: { ...helpers.emptyVipDraft(), selected: [dancers[0].id] },
    onChange() {}, onSubmit: async () => {}, onFavorite: async () => {}, favoritePending: [], busy: false };
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : [];
  const dock = options => nodes(Planner({ ...props, ...options })).find(node => node.props?.className === 'vip-mobile-continue');
  for (const motion of [false, true]) {
    reducedMotion = motion;
    const control = nodes(dock()).find(node => node.type === 'button');
    assert.equal(control.props['aria-controls'], 'vip-visit-details'); assert.equal(control.props.disabled, false);
    control.props.onClick();
    assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [['scroll', { block: 'start', behavior: motion ? 'auto' : 'smooth' }], ['focus', { preventScroll: true }]]);
  }
  assert.equal(nodes(dock({ busy: true })).find(node => node.type === 'button').props.disabled, true);
  assert.equal(nodes(dock()).find(node => node.type === 'strong').props.children, 1);
  assert.equal(dock({ draft: helpers.emptyVipDraft() }), undefined);
});
