import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const shared = postcss.parse(readFileSync(new URL('../public/dancr-ui-consistency.v1.css', import.meta.url), 'utf8'));
const dashboard = postcss.parse(readFileSync(new URL('../app/dashboard/customer-night.css', import.meta.url), 'utf8'));
const menus = postcss.parse(readFileSync(new URL('../app/components/dashboard-menu.css', import.meta.url), 'utf8'));
const venue = postcss.parse(readFileSync(new URL('../app/dashboard/venue-dancer-grid.css', import.meta.url), 'utf8'));
const summary = 'body.dancr-button-system [data-compact-menu] > summary';
const dancer = 'body.dancr-button-system main#customer-dashboard.dashboard-shell.dashboard-shell-customer .customer-dancer-menu>summary';
const trigger = 'html body.dancr-button-system :is(summary.dashboard-menu-trigger, button.dashboard-menu-trigger)';

function rule(styles, selector) {
  let result;
  styles.walkRules(selector, entry => { result ||= entry; });
  assert.ok(result, selector);
  return result;
}

function declarations(entry) {
  return Object.fromEntries(entry.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node]));
}

test('dashboard menus replace the legacy face in the same cascade layer', () => {
  const face = rule(menus, `${trigger} > .dashboard-menu-dots`);
  const base = rule(shared, `${summary}::before`);
  assert.equal(face.parent.name, 'layer');
  assert.equal(face.parent.params, base.parent.params);
  for (const property of ['background', 'width', 'height']) {
    assert.equal(declarations(face)[property].important, true, `${property} must override the important shared geometry`);
  }
  assert.equal(declarations(rule(menus, `${trigger}::before,\n  ${trigger}::after`)).content.value, 'none');
});

test('dashboard menus match the venue card face inside a 44px corner tap target', () => {
  const target = declarations(rule(menus, trigger));
  for (const property of ['width', 'height', 'min-width', 'min-height']) assert.equal(target[property].value, '44px');
  const expectedTarget = declarations(rule(venue, 'body .venue-dancer-grid .venue-card-menu > summary'));
  const face = declarations(rule(menus, `${trigger} > .dashboard-menu-dots`));
  const expectedFace = declarations(rule(venue, 'body .venue-dancer-grid .venue-card-menu > summary > span'));
  const compact = value => value.replace(/\s+/g, '');
  for (const property of ['display', 'align-items', 'justify-content', 'padding']) {
    assert.equal(target[property].value, expectedTarget[property].value, property);
  }
  for (const property of ['display', 'place-items', 'width', 'height', 'border', 'border-radius', 'background', 'color', 'font', 'text-shadow']) {
    assert.equal(compact(face[property].value), compact(expectedFace[property].value), property);
  }
  assert.equal(declarations(rule(dashboard, dancer)).margin.value, '0 0 0 auto', 'customer menus stay at the right edge');
});

test('opening the menu changes its color without moving the dots or face', () => {
  const open = declarations(rule(menus, 'html body.dancr-button-system details[open] > summary.dashboard-menu-trigger > .dashboard-menu-dots,\n  html body.dancr-button-system button.dashboard-menu-trigger[aria-expanded="true"] > .dashboard-menu-dots'));
  assert.deepEqual(Object.keys(open), ['background']);
  assert.equal(open.background.value, 'rgba(5, 5, 8, .72)');
});
