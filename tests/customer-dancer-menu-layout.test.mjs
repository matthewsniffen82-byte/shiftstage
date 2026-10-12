import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const shared = postcss.parse(readFileSync(new URL('../public/dancr-ui-consistency.v1.css', import.meta.url), 'utf8'));
const dashboard = postcss.parse(readFileSync(new URL('../app/dashboard/customer-night.css', import.meta.url), 'utf8'));
const summary = 'body.dancr-button-system [data-compact-menu] > summary';
const dancer = 'body.dancr-button-system main#customer-dashboard.dashboard-shell.dashboard-shell-customer .customer-dancer-menu>summary';

function rule(styles, selector) {
  let result;
  styles.walkRules(selector, entry => { result = entry; });
  assert.ok(result, selector);
  return result;
}

function declarations(entry) {
  return Object.fromEntries(entry.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node]));
}

test('the dancer menu face overrides shared geometry in the same cascade layer', () => {
  const face = rule(dashboard, `${dancer}::before`);
  const base = rule(shared, `${summary}::before`);
  assert.equal(face.parent.name, 'layer');
  assert.equal(face.parent.params, base.parent.params);
  for (const property of ['inset', 'width', 'height']) {
    assert.equal(declarations(face)[property].important, true, `${property} must override the important shared geometry`);
  }
});

test('the dots and dark face have identical centers within the unchanged 44px tap target', () => {
  const target = declarations(rule(shared, summary));
  for (const property of ['width', 'height', 'min-width', 'min-height']) assert.equal(target[property].value, '44px');
  const face = declarations(rule(dashboard, `${dancer}::before`));
  const icon = declarations(rule(dashboard, `${dancer}>svg`));
  const size = declarations(rule(shared, `${summary} svg`));
  const [top, right, bottom, left] = face.inset.value.split(/\s+/);
  assert.deepEqual([bottom, left], ['auto', 'auto']);
  const px = value => { assert.match(value, /^\d+px$/); return Number.parseFloat(value); };
  const faceCenter = [44 - px(right) - px(face.width.value) / 2, px(top) + px(face.height.value) / 2];
  const iconCenter = [44 - px(icon.right.value) - px(size.width.value) / 2, px(icon.top.value) + px(size.height.value) / 2];
  assert.deepEqual(iconCenter, faceCenter);
});

test('opening the menu changes its color without moving the dots or face', () => {
  const open = declarations(rule(shared, 'body.dancr-button-system [data-compact-menu][open] > summary::before'));
  assert.deepEqual(Object.keys(open).sort(), ['background', 'border-color']);
});
