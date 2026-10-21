import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import { savedVenueCardStyles } from '../src/lib/dancr/saved-venue-card-styles.mjs';

const css = postcss.parse(readFileSync('public/dancr-ui-consistency.v1.css', 'utf8'));
let palette;
css.walkAtRules('layer', layer => {
  if (layer.params === 'dancr-follow-controls.location-icons') palette = layer;
});
assert.ok(palette);
const pins = palette.nodes.find(node => node.type === 'rule');
const declarations = Object.fromEntries(pins.nodes.map(node => [node.prop, node.value]));

test('location pins share the city color above general control colors without changing fills or sizing', () => {
  assert.deepEqual(declarations, {
    color: 'var(--dancr-color-icon-location)',
    stroke: 'currentColor',
    filter: 'none',
    'box-shadow': 'none',
  });
  assert.ok(pins.nodes.every(node => node.important));
  for (const target of ['.city-picker-trigger-icon', '.profile-venue-pin', '.profile-directions-button svg',
    '.profile-media-venue svg', '.home-tv-feed-venue svg', '.tv-card-venue-line svg', '[data-action-icon="pin"] *']) {
    assert.ok(pins.selector.includes(target), target);
  }
});

test('Rhino Internal and embedded surfaces keep their palette while public venue metadata does not exclude pins', () => {
  assert.ok(pins.selector.includes('html:not(.internal-profile-embed)'));
  assert.ok(pins.selector.includes('body.dancr-button-system:not(.venue-grid-embed)'));
  assert.ok(pins.selector.includes(':not(:where(\n        .ir-shell *, .venue-embed-profile-page *))'));
  assert.doesNotMatch(pins.selector, /data-venue-brand/);
});

test('shared venue pins are marked separately from clocks that reuse the venue-dot class', () => {
  const shell = readFileSync('src/live-shell/app/07-shift-window-for-date.js', 'utf8');
  const markup = name => vm.runInNewContext(`(${shell.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n    \\}`))[0]})()`);
  assert.match(markup('venueIconMarkup'), /class="venue-dot" data-action-icon="pin"/);
  assert.doesNotMatch(markup('clockIconMarkup'), /data-action-icon="pin"/);
  assert.doesNotMatch(pins.selector, /\.venue-dot(?:,| svg)/);
  const customer = readFileSync('app/dashboard/CustomerDashboardPanels.tsx', 'utf8');
  assert.match(customer, /data-action-icon=\{icon === "pin" \? "pin" : undefined\}/);
});

test('Saved cards retain the location color layer and branded exclusions', () => {
  const saved = postcss.parse(savedVenueCardStyles([palette.toString()]));
  assert.equal(saved.first.params, palette.params);
  assert.match(saved.first.first.selector, /^#customer-dashboard/);
  assert.ok(saved.first.first.selector.includes(pins.selector));
  assert.deepEqual(saved.first.first.nodes.map(node => [node.prop, node.value]), pins.nodes.map(node => [node.prop, node.value]));
});

test('header bell, share, account and filter use the city pin color while retaining active feedback', () => {
  const matches = [];
  css.walkRules(rule => {
    if (rule.selector.includes('#customerNotificationQuickBtn') && rule.nodes.some(node => node.prop === 'color' && node.value === declarations.color)) matches.push(rule);
  });
  assert.equal(matches.length, 1);
  assert.ok(matches[0].selector.includes('#dancerProfileShareQuickBtn'));
  assert.ok(matches[0].selector.includes('#accountBtn.account-icon-btn'));
  assert.ok(matches[0].selector.includes(':not(:is(.active, .is-open, [aria-expanded="true"], :focus-visible))'));
  assert.doesNotMatch(matches[0].selector, /guestMenuBtn|customerDealQuickBtn|bottom-nav/);
  const filters = [];
  css.walkRules(rule => {
    if (rule.selector.endsWith('#homeFilterToggle > .home-filter-toggle-icon')) filters.push(rule);
  });
  assert.equal(filters.length, 2);
  for (const rule of filters) assert.ok(rule.nodes.some(node => node.prop === 'color' && node.value === declarations.color));
});
