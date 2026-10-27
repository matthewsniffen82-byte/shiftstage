import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const readCss = path => postcss.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const themes = readCss('public/venue-brand-themes.css');
const palette = readCss('public/dancr-palette.v1.css');
const embed = readCss('public/venue-grid-embed.css');
const embedProfile = readCss('app/embed/venues/[slug]/dancers/[dancerSlug]/embedded-profile.css');

function ruleMatching(css, predicate) {
  const matches = [];
  css.walkRules(rule => { if (predicate(rule.selector)) matches.push(rule); });
  assert.equal(matches.length, 1);
  return matches[0];
}

function declaration(rule, property) {
  const found = rule.nodes.find(node => node.type === 'decl' && node.prop === property);
  assert.ok(found, property);
  return found;
}

test('venue profiles use the shared charcoal frame without changing geometry', () => {
  const frame = ruleMatching(palette, selector => selector.includes(':where(.public-profile-shell, #profileBackdrop #profileModal).profile-split-layout::before'));
  assert.equal(declaration(frame, 'box-shadow').value, 'inset 0 0 0 1px var(--dancr-color-border)');
  assert.equal(declaration(frame, 'box-shadow').important, true);
  assert.deepEqual(frame.nodes.filter(node => node.type === 'decl').map(node => node.prop), ['box-shadow']);
  const surface = ruleMatching(palette, selector => selector.includes(frame.selector.replace('::before', '::after')));
  assert.equal(declaration(surface, 'background').value, 'var(--dancr-color-surface-card)');
  const websiteSurface = ruleMatching(embedProfile, selector => selector.endsWith('.public-profile-shell.profile-split-layout::after'));
  assert.equal(declaration(websiteSurface, 'background').value, 'var(--dancr-color-surface)');
});

test('embedded dancer cards use the same neutral border without resizing cards', () => {
  const card = ruleMatching(embed, selector => selector === 'html body.venue-grid-embed #results.home-dancer-grid > .home-dancer-grid-card');
  const border = declaration(card, 'border-color');
  assert.equal(border.value, 'var(--dancr-color-border)');
  assert.equal(border.important, true);
  assert.equal(declaration(card, 'background').value, 'linear-gradient(var(--dancr-color-surface), var(--dancr-color-surface))');
  assert.deepEqual(card.nodes.filter(node => node.type === 'decl').map(node => node.prop), ['border-color', 'background', 'box-shadow']);
});

test('dedicated venue themes change paint while shared card geometry and focus remain intact', () => {
  const paint = new Set(['color', 'stroke', '-webkit-text-fill-color', 'text-shadow', 'box-shadow']);
  themes.walkDecls(decl => {
    if (decl.parent.parent.type === 'atrule') {
      assert.ok(decl.prop.startsWith('--') || paint.has(decl.prop), decl.prop);
      assert.equal(decl.important, true);
    } else assert.ok(['margin-top', 'margin-bottom', 'height', 'max-height'].includes(decl.prop), decl.prop);
  });
  const focus = ruleMatching(embed, selector => selector === 'html body.venue-grid-embed :is(a, button):focus-visible');
  assert.equal(declaration(focus, 'outline').value, '2px solid var(--embed-accent)');
  const variables = [];
  palette.walkDecls('--embed-accent', decl => variables.push(decl.value));
  assert.deepEqual(variables, ['var(--dancr-color-brand-primary)']);
});
