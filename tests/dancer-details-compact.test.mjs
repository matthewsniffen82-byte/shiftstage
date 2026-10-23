import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(readFileSync('app/dashboard/dancer-profile-workspace.css', 'utf8'));
const scope = 'body.dancr-button-system main#dancer-dashboard.dashboard-shell.dashboard-shell-dancer .dancer-profile-workspace:not([data-onboarding]) #dancer-details-section';
function values(suffix = '') {
  const result = {};
  css.walkRules(rule => {
    if (rule.selector === scope + suffix) rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}

test('Your details uses tighter padding and heading spacing only in the saved profile', () => {
  assert.equal(values().padding, '10px');
  assert.equal(values(' > header').margin, '0 0 8px');
  assert.equal(values(' > header > h3')['font-size'], '16px');
  css.walkRules(rule => {
    if (!rule.selector.includes('#dancer-details-section')) return;
    assert.ok(rule.selector.startsWith(scope), 'do not alter onboarding, media, or navigation');
    rule.walkDecls('display', decl => assert.notEqual(decl.value, 'none'));
  });
});

test('stage name and city remain full-width touch targets with readable mobile text', () => {
  const form = values(' .dancer-profile-identity-form');
  assert.equal(form['grid-template-columns'], 'minmax(0,1fr)');
  assert.equal(form.gap, '8px');
  assert.equal(values(' .dancer-profile-identity-form > label').gap, '4px');
  const controls = values(' .dancer-profile-identity-form :is(input,select)');
  assert.equal(controls.height, '44px');
  assert.equal(controls['min-height'], '44px');
  assert.equal(controls['font-size'], '16px');
  assert.equal(controls.width, '100%');
  assert.equal(controls['min-width'], '0');
  assert.equal(controls['box-sizing'], 'border-box');
  assert.equal(controls.padding, '6px 10px');
});

test('save status stays visible and can grow for errors without extra margins', () => {
  const status = values(' .dancer-form-save-state');
  assert.equal(status.margin, '0');
  assert.equal(status['min-height'], '16px');
  assert.equal(status['overflow-wrap'], 'anywhere');
  assert.equal(status.height, undefined);
  assert.equal(status.overflow, undefined);
});
