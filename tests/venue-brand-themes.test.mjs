import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
const css = postcss.parse(readFileSync('public/venue-brand-themes.css', 'utf8'));
test('club embeds use saved accents without hardcoded club branding', () => {
  const rules = []; css.walkRules(rule => rules.push(rule));
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.match(rule.selector, /venue-grid-embed|venue-embed-profile-page/);
    assert.doesNotMatch(rule.selector, /spearmint|rhino|talk-of-the-town/i);
  }
  assert.match(css.toString(), /var\(--embed-accent, #6d28ff\)/);
});

test('both profile media bars use the club image layer instead of the public purple image', () => {
  const layout = postcss.parse(readFileSync('public/dancer-profile-layout.css', 'utf8'));
  let indicator;
  layout.walkRules(rule => {
    if (rule.selector.endsWith(':is(.profile-modal-media-tabs, .profile-media-tabs)::after')
      && rule.nodes.some(node => node.prop === 'background')) indicator = rule;
  });
  const background = indicator.nodes.find(node => node.prop === 'background');
  assert.equal(background.important, true);
  assert.match(background.value, /var\(--profile-media-tab-indicator-image, url\(/, 'the club paint replaces the opaque violet SVG, not just its background color');
  const overrides = [];
  css.walkDecls('--profile-media-tab-indicator-image', decl => overrides.push(decl));
  assert.equal(overrides.length, 1);
  assert.match(overrides[0].parent.selector, /\.venue-embed-profile-page/);
  assert.equal(overrides[0].value, 'linear-gradient(var(--embed-accent, #6d28ff), var(--embed-accent, #6d28ff))');
  assert.equal(overrides[0].important, true);
});
