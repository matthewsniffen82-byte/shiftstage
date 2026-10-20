import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const readCss = path => postcss.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const themes = readCss('public/venue-brand-themes.css');
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

test('all branded full profiles use a neutral frame and black information panel without changing geometry', () => {
  const frame = ruleMatching(themes, selector => selector.endsWith(':not(.dancer-profile-preview-shell)::before'));
  assert.match(frame.selector, /\[data-venue-brand\]:not\(\[data-venue-brand=""\]\)/);
  assert.doesNotMatch(frame.selector, /talk-of-the-town|spearmint-rhino-las-vegas-demo/);
  assert.match(frame.selector, /:where\(html\.internal-profile-embed \*, \.venue-embed-profile-page \*\)/);
  assert.match(frame.selector, /:not\(\.dancer-profile-preview-shell\)/);
  const stroke = declaration(frame, 'box-shadow');
  assert.equal(stroke.value, 'inset 0 0 0 1px #3a3a40');
  assert.equal(stroke.important, true);
  assert.equal(declaration(frame, 'z-index').value, '11');
  assert.deepEqual(frame.nodes.filter(node => node.type === 'decl').map(node => node.prop), ['box-shadow', 'z-index']);
  const surface = ruleMatching(themes, selector => selector === frame.selector.replace('::before', '::after'));
  const background = declaration(surface, 'background').value;
  assert.equal(background, '#000 linear-gradient(#000, #000)');
  assert.equal(declaration(surface, 'background').important, true);
  const websiteSurface = ruleMatching(embedProfile, selector => selector.endsWith('.public-profile-shell.profile-split-layout::after'));
  assert.equal(declaration(websiteSurface, 'background').value, background, 'Internal and website profile surfaces stay consistent');
});

test('embedded dancer cards use the same neutral border without resizing cards', () => {
  const card = ruleMatching(embed, selector => selector === 'html body.venue-grid-embed #results.home-dancer-grid > .home-dancer-grid-card');
  const border = declaration(card, 'border-color');
  assert.equal(border.value, '#3a3a40');
  assert.equal(border.important, true);
  assert.equal(declaration(card, 'background').value, 'linear-gradient(#161618, #161618)');
  assert.deepEqual(card.nodes.filter(node => node.type === 'decl').map(node => node.prop), ['border-color', 'background', 'box-shadow']);
});

test('venue-colored actions, icons, active tabs and keyboard focus remain accented', () => {
  const cta = ruleMatching(themes, selector => selector.includes('.profile-free-entry-action,'));
  assert.equal(declaration(cta, 'background').value, '#b8860b');
  assert.equal(declaration(cta, 'border-color').value, '#e8ce82');
  const icons = ruleMatching(themes, selector => selector.includes('.profile-modal-city-icon, .profile-venue-pin') && selector.includes('.venue-address-directions svg'));
  assert.equal(declaration(icons, 'color').value, '#e8ce82');
  const tab = ruleMatching(themes, selector => selector.includes('.profile-modal-media-tabs > button.active') && selector.endsWith('::after'));
  assert.match(declaration(tab, 'background').value, /%23b8860b/);
  const focus = ruleMatching(embed, selector => selector === 'html body.venue-grid-embed :is(a, button):focus-visible');
  assert.equal(declaration(focus, 'outline').value, '2px solid var(--embed-accent)');
});
