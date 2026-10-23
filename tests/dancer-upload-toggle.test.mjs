import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../app/dashboard/dancer-profile-builder.css', import.meta.url), 'utf8'));
const selector = "body.dancr-button-system #dancer-dashboard .dancer-builder-upload-entry > button";
const selected = `${selector}[aria-pressed='true']`;
function declarations(selector, layered = true) {
  let match;
  css.walkRules(rule => { if (rule.selector === selector) match = rule; });
  assert.ok(match, selector);
  if (layered) {
    assert.equal(match.parent.name, 'layer');
    assert.equal(match.parent.params, 'dancr-profile-builder-controls');
  }
  return Object.fromEntries(match.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
}
test('photo and video entry buttons share one equal-width row with touch-sized targets', () => {
  const row = declarations(selector.replace(' > button', ''), false);
  assert.equal(row.display, 'grid');
  assert.equal(row['grid-template-columns'], 'repeat(2,minmax(0,1fr))');
  const base = declarations(selector);
  assert.equal(base['min-height'], '44px');
  assert.equal(base.width, '100%');
  assert.equal(base['min-width'], '0');
  assert.equal(base.margin, '0');
  assert.equal(base.opacity, '1');
  assert.equal(base.cursor, 'pointer');
  assert.equal(base['border-radius'], '8px');
  assert.equal(base.appearance, 'none');
  assert.equal(base['color-scheme'], 'only dark');
  assert.equal(base['-webkit-text-fill-color'], 'currentColor');
});

test('only the selected media type uses the site brand color', () => {
  const base = declarations(selector), active = declarations(selected);
  assert.match(base.background, /var\(--dancr-color-control-secondary\)/);
  assert.match(active.background, /var\(--dancr-color-brand-primary\)/);
  assert.equal(active['border-color'], 'var(--dancr-color-brand-primary)');
});

test('tapping does not highlight the border; press, keyboard focus and disabled feedback remain', () => {
  css.walkRules(rule => {
    if (rule.selector.startsWith(selector) && /:hover|:active/.test(rule.selector)) {
      assert.ok(!rule.nodes.some(node => node.type === 'decl' && /^(border|outline)/.test(node.prop)));
    }
  });
  assert.notEqual(declarations(`${selector}:active:not(:disabled)`)['box-shadow'], 'none');
  const disabled = declarations(`${selector}:disabled`);
  assert.equal(disabled.opacity, '.55');
  assert.equal(disabled.cursor, 'wait');
  assert.equal(disabled['box-shadow'], 'none');
  let focus;
  css.walkRules(rule => {
    if (rule.selector.includes('.dancer-builder-upload-entry) > button:focus-visible')) focus = rule;
  });
  assert.ok(focus.nodes.some(node => node.prop === 'outline' && node.value.startsWith('2px solid')));
});
