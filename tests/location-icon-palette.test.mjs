import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import sharp from 'sharp';
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
  assert.match(pins.selector, /:not\(:where\(\s*\.ir-shell \*, \.venue-embed-profile-page \*\)\)/);
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

test('roster pins hide the SVG only after paint succeeds and keep it for forced colors', () => {
  const svg = '#results .home-dancer-grid-venue > [data-action-icon="pin"]:has(> .club-brand-pin-paint) > svg';
  const canvas = '#results .home-dancer-grid-venue .club-brand-pin-paint';
  const rules = [];
  palette.walkRules(rule => {
    if (rule.selector === svg || rule.selector === canvas) rules.push(rule);
  });
  assert.deepEqual(rules.map(rule => [rule.selector, rule.parent.params, rule.first.prop, rule.first.value]), [
    [svg, '(forced-colors: none)', 'visibility', 'hidden'],
    [canvas, '(forced-colors: active)', 'display', 'none'],
  ]);
});

test('Android profile pins retain their SVG outlines and the exact brand color on public profiles', async () => {
  const layout = postcss.parse(readFileSync('public/dancer-profile-layout.css', 'utf8'));
  let rule;
  layout.walkDecls('stroke-opacity', decl => {
    if (decl.value === '0' && decl.parent.selector.includes('.profile-venue-destination')) rule = decl.parent;
  });
  assert.ok(rule);
  assert.equal(rule.parent.params, 'screen and (forced-colors: none)');
  assert.match(rule.selector, /html:is\(\.is-android, \.is-samsung-browser\):not\(\.internal-profile-embed\)/);
  assert.match(rule.selector, /:not\(:where\(\.ir-shell \*, \.venue-embed-profile-page \*\)\)/);
  assert.match(rule.selector, /\.profile-venue-destination > \[data-action-icon="pin"\] > svg/);
  for (const target of ['svg.profile-modal-city-icon', '.public-profile-shell svg.profile-venue-pin',
    '.profile-directions-button > svg', '.profile-primary-directions [data-action-icon="pin"] > svg', '.profile-media-venue svg']) {
    assert.ok(rule.selector.includes(target), target);
  }
  const positions = {};
  rule.parent.walkDecls('--profile-pin-position', decl => { positions[decl.parent.selector] = decl.value; });
  assert.deepEqual(positions, { '.profile-venue-destination': 'center', ':is(.profile-primary-directions, .profile-media-venue)': 'right' });
  const background = rule.nodes.find(decl => decl.prop === 'background').value;
  assert.match(background, /var\(--profile-pin-position, left\) center \/ 300% 100% no-repeat/);
  const png = Buffer.from(background.match(/base64,([^"]+)/)[1], 'base64');
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [216, 72]);

  const tokens = readFileSync('public/dancr-brand-tokens.v1.css', 'utf8');
  const rgb = tokens.match(/--dancr-color-brand-primary:\s*#([a-f0-9]{6});/)[1];
  const shell = readFileSync('src/live-shell/app/07-shift-window-for-date.js', 'utf8');
  const profile = readFileSync('app/dancers/[slug]/PublicDancerProfile.tsx', 'utf8');
  const media = readFileSync('app/dancers/[slug]/DancerPhotoCarousel.tsx', 'utf8');
  const shapes = [
    profile.split('function VenuePinIcon()')[1],
    shell.split('function venueIconMarkup()')[1],
    media.split('function VenuePinIcon()')[1],
  ];
  for (const [index, source] of shapes.entries()) {
    const shape = source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1];
    const original = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
    const alpha = await sharp(Buffer.from(original)).extractChannel('alpha').raw().toBuffer();
    for (let pixel = 0; pixel < alpha.length; pixel++) {
      const offset = 4 * (Math.floor(pixel / 72) * info.width + index * 72 + pixel % 72);
      // The PNG stores sixteen opacity levels for antialiased edges.
      assert.ok(Math.abs(alpha[pixel] - data[offset + 3]) <= 9, `pin ${index}, pixel ${pixel}`);
      if (data[offset + 3]) assert.equal(data.subarray(offset, offset + 3).toString('hex'), rgb);
    }
  }
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
