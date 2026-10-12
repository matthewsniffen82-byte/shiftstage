import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../app/dashboard/customer-night.css', import.meta.url), 'utf8'));
const scope = 'body.dancr-button-system main#customer-dashboard.dashboard-shell.dashboard-shell-customer ';
function declarations(selector) {
  const result = {};
  css.walkRules(`${scope}${selector}`, rule => rule.walkDecls(decl => { result[decl.prop] = decl; }));
  return result;
}

test('saved deals reserve space for their menu and allow long mobile titles to wrap', () => {
  const card = declarations('.saved-deal-bookmark');
  assert.equal(card.display.value, 'grid');
  assert.equal(card['grid-template-columns'].value, 'minmax(0,1fr) 44px');
  assert.equal(card.padding.value, '12px');
  assert.equal(card['border-radius'].value, '8px');
  assert.equal(card['border-radius'].important, true, 'overrides legacy card rounding');
  assert.equal(card.background.important, true, 'overrides the shared dark card fill');
  assert.equal(card.overflow.value, 'visible', 'the Remove menu must not be clipped');
  assert.equal(declarations('.saved-deal-copy')['overflow-wrap'].value, 'anywhere');
  assert.equal(declarations('.saved-deal-copy>strong')['white-space'].value, 'normal');
});

test('the full-width footer keeps a stable directions target beside a flexible primary action', () => {
  const actions = declarations('.saved-deal-actions');
  assert.equal(actions.display.value, 'grid');
  assert.equal(actions.display.important, true, 'overrides shared flex actions');
  assert.equal(actions['grid-column'].value, '1/-1');
  assert.equal(actions['grid-template-columns'].value, 'minmax(0,1fr) 44px');
  const controls = declarations('.saved-deal-actions>:is(a,button)');
  assert.equal(controls['min-height'].value, '44px');
  assert.equal(controls['min-width'].value, '0');
  assert.equal(controls['white-space'].value, 'normal');
  assert.equal(controls.appearance.value, 'none');
  assert.equal(declarations('.saved-deal-actions>.saved-deal-view').background.value, 'linear-gradient(#241733,#241733)');
  assert.equal(declarations('.saved-deal-actions>button svg').width.value, '20px');
});
