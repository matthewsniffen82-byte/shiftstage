import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
import { RHINO_ACCENT } from '../src/lib/dancr/rhino-locations.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const css = postcss.parse(read('public/venue-brand-themes.css'));
const paintRules = [];
css.walkAtRules('layer', layer => layer.walkRules(rule => paintRules.push(rule)));
const tokens = Object.fromEntries(paintRules[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('Rhino theme is limited to its dedicated rosters, embeds and Internal profile documents', () => {
  assert.ok(paintRules.length > 0);
  for (const rule of paintRules) {
    assert.match(rule.selector, /^html body\.dancr-button-system:is\(/);
    assert.match(rule.selector, /\.venue-grid-embed:is\(\[data-venue-slug="talk-of-the-town"\]/);
    assert.match(rule.selector, /:has\(\.ir-shell:not\(\.ir-embedded\):is\(\[data-venue-brand="talk-of-the-town"\]/);
    assert.match(rule.selector, /:has\(\.venue-embed-profile-page:is\(\[data-venue-slug="talk-of-the-town"\]/);
    assert.match(rule.selector, /\[data-internal-profile-audience="guest"\].*\[data-internal-profile-audience="staff"\]/);
    assert.match(rule.selector, /\[data-internal-venue-brand="talk-of-the-town"\]/);
    assert.match(rule.selector, /spearmint-rhino-las-vegas-demo/);
    assert.doesNotMatch(rule.selector, /data-internal-profile-audience="public"|\.dashboard-shell|\.admin-shell/);
  }
  assert.match(read('app/embed/venues/[slug]/route.ts'), /<link href="\/venue-brand-themes\.css" rel="stylesheet">/);
  assert.match(read('app/embed/venues/[slug]/dancers/[dancerSlug]/EmbeddedDancerProfile.tsx'), /className="venue-embed-profile-page" data-venue-slug=\{venueSlug\}/);
});

test('logo gold has readable action text and dark surfaces retain readable text and icons', () => {
  assert.equal(tokens['--dancr-color-brand-primary'], RHINO_ACCENT);
  const action = paintRules.find(rule => rule.selector.includes('.ir-table-request'));
  const actionText = action.nodes.find(node => node.prop === 'color').value;
  assert.ok(contrast(RHINO_ACCENT, actionText) >= 4.5);
  for (const surface of ['--dancr-color-background', '--dancr-color-surface', '--dancr-color-control-secondary']) {
    for (const foreground of ['--dancr-color-text-primary', '--dancr-color-text-muted', '--dancr-color-icon-location']) {
      assert.ok(contrast(tokens[surface], tokens[foreground]) >= 4.5, `${foreground} on ${surface}`);
    }
  }
});

test('working, request and error states remain semantic; branded paint never changes geometry or media', () => {
  for (const key of Object.keys(tokens)) assert.doesNotMatch(key, /success|live|danger|verification/);
  const action = paintRules.find(rule => rule.selector.includes('.ir-table-request'));
  for (const state of [':disabled', '[aria-disabled="true"]', '[data-request-sent]', '.is-confirmed', '[class*="reject"]']) {
    assert.ok(action.selector.includes(state), state);
  }
  const allowed = new Set(['color', '-webkit-text-fill-color', 'text-shadow', 'box-shadow']);
  for (const rule of paintRules) {
    for (const decl of rule.nodes.filter(node => node.type === 'decl')) {
      assert.ok(decl.prop.startsWith('--') || allowed.has(decl.prop), decl.prop);
      assert.equal(decl.important, true);
    }
  }
});
