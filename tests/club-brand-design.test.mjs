import assert from 'node:assert/strict';
import test from 'node:test';
import { clubBrandFixture } from './helpers/club-brand-render.mjs';
import { savedClubFixture } from './helpers/saved-club-render.mjs';

test('club discovery and profile use the original full logo and never cover media', () => {
  for (const logo of ['/venue-logos/palomino-club.svg', '/venue-logos/fictional/aurora-room.svg', '/uploaded/logo.webp', '/uploaded/logo.png']) {
    const f = clubBrandFixture({ logoImageUrl: logo });
    for (const render of [f.card, f.feed, f.hero]) {
      const html = render();
      assert.ok(html.includes(`src="${logo}"`));
      assert.match(html, /data-club-logo-fit="artwork"/);
      assert.doesNotMatch(html, /never-use-this-photo|--custom-photo|venue_cover|fictional\/marks/);
      assert.match(html, /club-logo-fallback/);
    }
    assert.match(f.feed(4), /loading="lazy"/);
    assert.match(f.hero(), /loading="eager"/);
  }
});

test('saved club cards keep the full logo, total count, and independent actions', () => {
  const f = savedClubFixture({ activity: { workingNowCount: 7,
    workingDancers: Array.from({ length: 7 }, (_, i) => ({ id: `d-${i}`, stageName: `Dancer ${i}` })) } });
  const markup = f.markup();
  assert.match(markup, /data-club-logo-fit="artwork"/);
  assert.doesNotMatch(markup, /never-use-this-photo|--custom-photo|venue_cover/);
  assert.match(markup, /<strong>7<\/strong><span>working now<\/span>/);
  assert.equal((markup.match(/data-profile-id=/g) || []).length, 5);
  assert.match(markup, /aria-label="2 more dancers working now">\+<\/span>/);
  const buttons = [];
  const walk = node => { if (!node || typeof node !== 'object') return;
    if (node.type === 'button') buttons.push(node.props);
    for (const child of [node.props?.children].flat(Infinity)) walk(child);
  };
  walk(f.tree());
  buttons.find(button => button['aria-label'] === 'Free Entry at Test Club').onClick();
  buttons.find(button => button['aria-label'] === "Open Test Club's full club profile").onClick();
  buttons.find(button => button['aria-label'] === 'Directions to Test Club').onClick();
  buttons.find(button => button['data-venue-follow']).onClick();
  assert.deepEqual(f.destinations, ['/deals/transportation/entry-one?sourceType=club_page', '/venues/test-club']);
  assert.deepEqual(f.directions, ['club-one']); assert.deepEqual(f.unfollows, ['club-one']);
  assert.match(savedClubFixture({ logoImageUrl: '' }, { entryDealId: undefined }).markup(), /club-logo-fallback/);
  assert.match(savedClubFixture({}, { entryDealId: undefined }).markup(), /disabled=""[^>]*aria-label="Free Entry unavailable/);
});

test('club card actions keep the original destinations, entry configuration, and follow identity', () => {
  const f = clubBrandFixture();
  for (const render of [f.card, f.feed, f.hero]) {
    const html = render();
    assert.equal((html.match(/data-venue-follow="club-one"/g) || []).length, 1);
    assert.match(html, /aria-pressed="false"/);
    assert.ok(html.includes('https://maps.google.com/?q=123%20Main%20St%2C%20Las%20Vegas%2C%20NV'));
    assert.equal((html.match(/data-club-deal-cta=/g) || []).length, 1);
    assert.match(html, /&quot;sourceType&quot;:&quot;club_page&quot;/);
    assert.match(html, /&quot;venueId&quot;:&quot;club-one&quot;/);
  }
  assert.match(f.feed(), /data-open-venue-profile="club-one"/);
  assert.match(f.card(), /href="\/\?venue=test-club"/);
  const hero = f.hero();
  assert.equal((hero.match(/data-share-venue=/g) || []).length, 1);
  assert.equal((hero.match(/data-close-venue-profile/g) || []).length, 1);
  const heroEnd = hero.lastIndexOf('</article>', hero.indexOf('venue-detail-exploration'));
  for (const action of ['data-share-venue=', 'data-venue-follow=', 'https://maps.google.com/']) {
    assert.ok(hero.indexOf(action) < heroEnd, `${action} stays in the hero action rail`);
  }
  assert.match(hero, /data-venue-follow="club-one"[^>]*aria-label="Follow Test Club"/);
  assert.match(hero.slice(0, heroEnd), /<p class="club-brand-address">123 Main St, Las Vegas, NV<\/p>/);
  assert.doesNotMatch(hero.slice(heroEnd), /123 Main St, Las Vegas, NV|club-profile-location/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.events.at(-1))), { venueId: 'club-one', eventType: 'page_view', source: 'venue_page' });
});

test('unavailable entry, missing logos, unknown hours, and unavailable directions preserve their states', () => {
  const f = clubBrandFixture({ activeDeal: null, logoImageUrl: '', address: '', hours: '' });
  assert.doesNotMatch(f.card() + f.hero(), /data-club-deal-cta=/);
  assert.match(f.feed(), /data-card-qr-message="Free entry is currently unavailable/);
  for (const render of [f.card, f.feed, f.hero]) {
    const html = render();
    assert.match(html, /club-logo-fallback/);
    assert.doesNotMatch(html, /data-club-logo-fit/);
    assert.match(html, /Hours unavailable/);
    assert.match(html, /data-travel-unavailable="directions" disabled/);
    assert.doesNotMatch(html, /club-brand-address/);
  }
});

test('scroll-card previews keep five thumbnails while the detail page shows one full roster and count', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `dancer-${i}`, name: `Dancer ${i}`, venueId: 'club-one', working: true, position: i }));
  rows.push({ id: 'offline', venueId: 'club-one', working: false }, { id: 'private', venueId: 'club-one', working: true, approved: false });
  const f = clubBrandFixture({}, rows);
  for (const render of [f.card, f.feed]) {
    const html = render();
    assert.equal((html.match(/data-venue-dancer-profile/g) || []).length, 5);
    assert.match(html, /<strong>6<\/strong><span>working now<\/span>/);
    assert.match(html, /aria-label="1 more dancer working now">\+<\/span>/);
  }
  assert.equal((f.hero().match(/data-grid-dancer=/g) || []).length, 6);
  assert.equal((f.hero().match(/Working now · 6/g) || []).length, 1);
  assert.doesNotMatch(f.hero(), /club-card-lineup|club-lineup-label|club-lineup-more|data-venue-dancer-profile/);
  rows[0].working = false;
  assert.match(f.feed(), /<strong>5<\/strong><span>working now<\/span>/);
  assert.doesNotMatch(f.feed(), /club-lineup-more/);
  assert.match(f.hero(), /Working now · 5/);
  assert.equal((f.hero().match(/data-grid-dancer=/g) || []).length, 5);
});

test('lineup overflow shows a plus and keeps the remaining count accessible', () => {
  for (const count of [0, 1, 5, 6, 21]) {
    const dancers = Array.from({ length: count }, (_, i) => ({ id: `d-${i}`, name: `Dancer ${i}`, stageName: `Dancer ${i}`, venueId: 'club-one', working: true }));
    const publicClub = clubBrandFixture({}, dancers);
    // Saved receives a short thumbnail list alongside the full count.
    const saved = savedClubFixture({ activity: { workingNowCount: count, workingDancers: dancers.slice(0, 5) } });
    for (const render of [publicClub.card, publicClub.feed, saved.markup]) {
      const markup = render();
      if (count <= 5) assert.doesNotMatch(markup, /club-lineup-more/, `no overflow badge for ${count}`);
      else {
        const remaining = count - 5;
        assert.match(markup, new RegExp(`class="club-lineup-more" role="img" aria-label="${remaining} more ${remaining === 1 ? 'dancer' : 'dancers'} working now">\\+</span>`));
        assert.match(markup, new RegExp(`<strong>${count}</strong><span>working now</span>`));
      }
    }
  }
  const partial = savedClubFixture({ activity: { workingNowCount: 21, workingDancers: [{ id: 'ty', stageName: 'Ty' }] } }).markup();
  assert.match(partial, /aria-label="20 more dancers working now">\+<\/span>/);
});
