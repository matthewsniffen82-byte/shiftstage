import assert from 'node:assert/strict';
import test from 'node:test';
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
