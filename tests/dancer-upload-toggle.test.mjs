import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../app/dashboard/dancer-profile-builder.css', import.meta.url), 'utf8'));
const selector = "body.dancr-button-system #dancer-dashboard .dancer-builder-upload-entry > button";
const expanded = `${selector}[aria-expanded='true']`;
function declarations(selector) {
  let match;
  css.walkRules(rule => { if (rule.selector === selector) match = rule; });
  assert.ok(match, selector);
  assert.equal(match.parent.name, 'layer');
  assert.equal(match.parent.params, 'dancr-profile-builder-controls');
  return Object.fromEntries(match.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
}
function contrast(first, second) {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('Close uploads has an opaque button face, readable label and visible edge', () => {
  const base = declarations(selector), open = declarations(expanded);
  assert.equal(base['min-height'], '44px');
  assert.equal(base.width, '100%');
  assert.equal(open.background, '#292930');
  assert.equal(open.opacity, '1');
  assert.equal(open.cursor, 'pointer');
  assert.equal(open['border-radius'], '8px');
  assert.equal(open.appearance, 'none');
  assert.equal(open['color-scheme'], 'only dark');
  assert.equal(base['-webkit-text-fill-color'], 'currentColor');
  assert.ok(contrast(open.color, open.background) >= 4.5);
  assert.ok(contrast(open['border-color'], open.background) >= 3);
});

test('hover, press, keyboard focus and disabled states remain distinct', () => {
  const open = declarations(expanded);
  for (const state of ['hover', 'active']) {
    const style = declarations(`${expanded}:${state}:not(:disabled)`);
    assert.notEqual(style.background, open.background);
    assert.ok(contrast(open.color, style.background) >= 4.5);
  }
  const disabled = declarations(`${expanded}:disabled`);
  assert.equal(disabled.opacity, '.55');
  assert.equal(disabled.cursor, 'wait');
  assert.equal(disabled['box-shadow'], 'none');
  let focus;
  css.walkRules(rule => {
    if (rule.selector.includes('.dancer-builder-upload-entry) > button:focus-visible')) focus = rule;
  });
  assert.ok(focus.nodes.some(node => node.prop === 'outline' && node.value.startsWith('2px solid')));
});
