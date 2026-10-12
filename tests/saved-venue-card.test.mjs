import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { savedVenueCardStyles } from '../src/lib/dancr/saved-venue-card-styles.mjs';
import { venueOperatingStatus } from '../src/lib/dancr/venue-operating-status.ts';

test('saved card styles preserve declarations, media conditions, specificity, and Android context', () => {
  const selector='html:is(.is-android, .android-rendering) body.dancr-button-system > .app main.stack > section.stack > #results.home-venue-discovery-feed > .home-venue-discovery-slide';
  const css=savedVenueCardStyles([`:root { --font-ui: Inter; background:red } @media(max-width:720px) { ${selector}::before { height:38px !important; background:black } } #results.venue-profile-overlay .venue-detail { width:10px }`]);
  const root=postcss.parse(css), rules=[];
  root.walkRules(rule=>rules.push(rule));
  assert.equal(rules.length,2);
  assert.equal(rules[0].selector,'#customer-dashboard [data-venue-scroll-feed]');
  assert.equal(rules[0].nodes.length,1);
  assert.equal(rules[1].parent.params,'(max-width:720px)');
  assert.equal(rules[1].selector,`#customer-dashboard :is(${selector}, :where(html:is(.is-android, .android-rendering) body.dancr-button-system  [data-venue-scroll-feed].home-venue-discovery-feed > .home-venue-discovery-slide))::before`);
  assert.equal(rules[1].nodes[0].value,'38px');
  assert.equal(rules[1].nodes[0].important,true);
  assert.equal(rules[1].nodes[1].value,'black');
});

test('club opening status handles overnight hours in the venue timezone and unknown data', () => {
  const venue={opensAt:'20:00:00',closesAt:'06:00:00',timezone:'America/Los_Angeles'};
  assert.equal(venueOperatingStatus(venue,new Date('2026-10-11T04:00:00Z')).label,'Open');
  assert.equal(venueOperatingStatus(venue,new Date('2026-10-11T12:59:00Z')).label,'Open');
  assert.equal(venueOperatingStatus(venue,new Date('2026-10-11T13:00:00Z')).label,'Closed');
  assert.equal(venueOperatingStatus({...venue,opensAt:'09:00',closesAt:'18:00'},new Date('2026-10-11T17:00:00Z')).label,'Open');
  for (const invalid of [{},{...venue,timezone:'invalid'},{...venue,opensAt:'25:00'}]) assert.equal(venueOperatingStatus(invalid).state,'unknown');
});

test('Saved includes the discovery icon dimensions and final violet admission styling', () => {
  const source = [
    readFileSync('src/live-shell/styles/base-styles-10-media.css', 'utf8'),
    readFileSync('public/dancr-aesthetic.v1.css', 'utf8'),
  ];
  const generated = postcss.parse(savedVenueCardStyles(source));
  const rules = [];
  generated.walkRules(rule => rules.push(rule));
  const icon = rules.find(rule => rule.selector === '#customer-dashboard :is(.venue-dot, :where(.venue-dot))');
  assert.ok(icon, 'the actual discovery icon wrapper is included');
  assert.ok(icon.nodes.some(decl => decl.prop === 'width' && decl.value === '14px'));
  assert.ok(icon.nodes.some(decl => decl.prop === 'height' && decl.value === '14px'));
  assert.ok(icon.nodes.some(decl => decl.prop === 'flex' && decl.value === '0 0 14px'));
  const svg = rules.find(rule => rule.selector === '#customer-dashboard :is(.venue-dot svg, :where(.venue-dot svg))');
  assert.ok(svg.nodes.some(decl => decl.prop === 'width' && decl.value === '100%'));
  assert.ok(svg.nodes.some(decl => decl.prop === 'height' && decl.value === '100%'));

  let sourceAdmission;
  postcss.parse(source[1]).walkRules(rule => {
    if (rule.selector.endsWith('.free-entry-cta:not(.is-unavailable)') && rule.nodes.some(decl => decl.prop === 'background')) sourceAdmission = rule;
  });
  assert.ok(sourceAdmission);
  const admission = rules.find(rule => rule.selector.startsWith(`#customer-dashboard :is(${sourceAdmission.selector}, :where(`));
  assert.ok(admission, 'shared html/body and grouped page selectors cannot be dropped');
  assert.deepEqual(admission.nodes.map(decl => [decl.prop, decl.value, decl.important]), sourceAdmission.nodes.map(decl => [decl.prop, decl.value, decl.important]));
  assert.ok(admission.nodes.some(decl => decl.prop === 'background' && decl.value.includes('--dancr-color-brand-primary')));
  const legacyGreen = rules.findIndex(rule => rule.selector.includes('.home-venue-discovery-rail-qr.is-available') && rule.nodes.some(decl => decl.prop === 'background' && decl.value.includes('--dancr-color-success')));
  assert.ok(rules.indexOf(admission) > legacyGreen, 'the final shared admission treatment follows the older green treatment');
});
