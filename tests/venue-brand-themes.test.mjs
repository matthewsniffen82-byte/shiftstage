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
