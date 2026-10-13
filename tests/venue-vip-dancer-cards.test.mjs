import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import * as types from '../src/lib/dancr/vip-types.ts';
import { importMediaModule } from './helpers/server-media-module.mjs';

const { responsivePublicImage } = await importMediaModule('responsive-image.ts');
const { withVenueVipDancerCards } = compileVip('src/lib/dancr/venue-vip-dancer-cards.ts', {
  './responsive-image': { responsivePublicImage },
});
const publicProfile = id => ({ id, status: 'approved', verification_status: 'approved', is_public: true, disabled_at: null, avatar_storage_path: `${id}/avatar.jpg` });
function database(profiles, photos = [], failure) {
  const calls = [];
  return { calls, client: { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    let rows = table === 'dancer_profiles' ? profiles : photos;
    const query = {
      select() { return query; },
      in(key, values) { call.filters.push([key, values]); rows = rows.filter(row => values.includes(row[key])); return query; },
      eq(key, value) { call.filters.push([key, value]); rows = rows.filter(row => row[key] === value); return query; },
      is(key, value) { return query.eq(key, value); },
      then(resolve, reject) { return Promise.resolve({ data: rows, error: table === failure ? new Error('Photo lookup failed') : null }).then(resolve, reject); },
    };
    return query;
  } } };
}

test('venue VIP cards batch only requested public dancers and prefer their approved main photo', async () => {
  const profiles = [publicProfile('main'), publicProfile('avatar'), publicProfile('external'),
    { ...publicProfile('private'), is_public: false }, { ...publicProfile('disabled'), disabled_at: '2026-01-01' },
    { ...publicProfile('unapproved'), verification_status: 'pending' }, publicProfile('unrequested')];
  profiles.find(p => p.id === 'external').avatar_storage_path = 'https://untrusted.example/photo.jpg';
  const db = database(profiles, [
    { dancer_id: 'main', storage_path: 'main/primary.r320-480.m800x1200.jpg', is_primary: true, review_status: 'approved' },
    { dancer_id: 'avatar', storage_path: 'avatar/unapproved.jpg', is_primary: true, review_status: 'pending' },
  ]);
  const requests = [{ id: 'request', dancers: profiles.filter(p => p.id !== 'unrequested').map(p => ({ id: p.id, stageName: p.id, photoUrl: 'stale' })) },
    { id: 'other-request', dancers: [{ id: 'main', stageName: 'Original request name' }] }];
  const result = await withVenueVipDancerCards(db.client, requests);
  const dancers = result[0].dancers;
  assert.match(dancers[0].photoUrl, /primary/);
  assert.match(dancers[0].photoSrcSet, /320w/);
  assert.match(dancers[1].photoUrl, /avatar/);
  assert.ok(dancers.slice(2).every(dancer => dancer.photoUrl === null && dancer.photoSrcSet === null));
  assert.equal(result[1].dancers[0].stageName, 'Original request name');
  assert.equal(requests[0].dancers[0].photoUrl, 'stale', 'do not mutate stored request snapshots');
  assert.equal(db.calls.length, 2, 'batch shared dancers instead of one request per card');
  assert.equal(db.calls[0].filters[0][1].length, 6);
  assert.deepEqual(Array.from(db.calls[1].filters[0][1]), ['main', 'avatar', 'external']);
  assert.doesNotMatch(JSON.stringify(result), /storage_path|unapproved.jpg|untrusted.example/);
});

test('large request pages use bounded image batches and failed lookups are not returned as missing photos', async () => {
  const profiles = Array.from({ length: 450 }, (_, index) => publicProfile(String(index)));
  const db = database(profiles);
  const requests = [{ id: 'page', dancers: profiles.map(p => ({ id: p.id, stageName: p.id })) }];
  const result = await withVenueVipDancerCards(db.client, requests);
  assert.equal(result[0].dancers.length, 450);
  assert.equal(db.calls.filter(call => call.table === 'dancer_profiles').length, 3);
  assert.ok(db.calls.every(call => call.filters[0][1].length <= 200));
  for (const failure of ['dancer_profiles', 'dancer_photos']) {
    await assert.rejects(withVenueVipDancerCards(database(profiles, [], failure).client, requests), /Photo lookup failed/);
  }
  const empty = database([]);
  assert.equal((await withVenueVipDancerCards(empty.client, [])).length, 0);
  assert.equal(empty.calls.length, 0);
});

const GridImage = compileVip('app/dashboard/VenueGridImage.tsx').default;
const Cards = compileVip('app/dashboard/VenueVipDancerCards.tsx', {
  '../internal/InternalRoster': { VenueRosterProfileButton: ({ dancerId, stageName, children, className }) =>
    React.createElement('button', { className, 'data-profile-id': dancerId, 'aria-label': `View ${stageName} profile` }, children) },
  './VenueGridImage': { __esModule: true, default: GridImage },
}).default;
const Requests = compileVip('app/vip/VipRequests.tsx', { '@/src/lib/dancr/vip-types': types }).default;

test('venue requests render every dancer as a shared portrait and profile target without changing guest requests', () => {
  const dancers = [{ id: 'aria', stageName: 'Aria', photoUrl: '/approved-photo', photoSrcSet: '/small 320w' },
    { id: 'coco', stageName: 'Coco', photoUrl: null }];
  const request = { id: 'visit', guest_name: 'Guest', status: 'pending', starts_at: '2026-10-15T04:00:00Z', timezone: 'America/Los_Angeles', dancers };
  const venue = renderToStaticMarkup(React.createElement(Requests, { requests: [request], onReview() {},
    renderDancers: item => React.createElement(Cards, { dancers: item.dancers }) }));
  assert.equal((venue.match(/class="venue-dancer-card"/g) || []).length, 2);
  assert.match(venue, /data-profile-id="aria" aria-label="View Aria profile"/);
  assert.match(venue, /data-profile-id="coco" aria-label="View Coco profile"/);
  assert.match(venue, /src="\/approved-photo"/);
  assert.match(venue, /Photo unavailable/);
  assert.match(venue, /Confirm request/);
  assert.match(venue, /Decline/);
  const guest = renderToStaticMarkup(React.createElement(Requests, { requests: [request] }));
  assert.match(guest, /Aria, Coco/);
  assert.doesNotMatch(guest, /venue-dancer-card|Confirm request/);
});

test('VIP request grids recover nested padding and retain the shared three-column card geometry', () => {
  const css = postcss.parse(readFileSync('app/dashboard/venue-vip.css', 'utf8'));
  const values = ending => {
    let found;
    css.walkRules(rule => { if (rule.selector.endsWith(ending)) found = Object.fromEntries(rule.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value])); });
    return found;
  };
  assert.equal(values('.venue-vip-requests .vip-request-list')['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(values('.venue-vip-requests .vip-request-list').width, 'calc(100% + 32px)');
  assert.equal(values('.venue-vip-requested-dancers .venue-dancer-grid').width, 'calc(100% + 26px)');
  assert.equal(values('.venue-dancer-grid button.venue-card-profile').padding, '0');
  const source = readFileSync('app/dashboard/VenueVipDancerCards.tsx', 'utf8');
  assert.match(source, /import "\.\/venue-dancer-grid\.css"/);
  assert.match(source, /className="venue-dancer-grid"/);
});
