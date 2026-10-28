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
  const f = savedClubFixture({ activity: { workingNowCount: 5,
    workingDancers: Array.from({ length: 5 }, (_, i) => ({ id: `d-${i}`, stageName: `Dancer ${i}` })) } });
  const markup = f.markup();
  assert.match(markup, /data-club-logo-fit="artwork"/);
  assert.doesNotMatch(markup, /never-use-this-photo|--custom-photo|venue_cover/);
  assert.match(markup, /<strong>5<\/strong><span>Working Now<\/span>/);
  assert.equal((markup.match(/data-profile-id=/g) || []).length, 3);
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
  const heroEnd = hero.lastIndexOf('</article>', hero.indexOf('club-profile-location'));
  for (const action of ['data-share-venue=', 'data-venue-follow=', 'https://maps.google.com/']) {
    assert.ok(hero.indexOf(action) < heroEnd, `${action} stays in the hero action rail`);
  }
  assert.match(hero, /data-venue-follow="club-one"[^>]*aria-label="Follow Test Club"/);
  assert.ok(hero.indexOf('club-profile-location') > hero.indexOf('</article>'));
  assert.match(hero, /123 Main St, Las Vegas, NV/);
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
  }
});

test('card and hero totals stay synchronized while their three thumbnails never limit the dancer grid', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `dancer-${i}`, name: `Dancer ${i}`, venueId: 'club-one', working: true, position: i }));
  rows.push({ id: 'offline', venueId: 'club-one', working: false }, { id: 'private', venueId: 'club-one', working: true, approved: false });
  const f = clubBrandFixture({}, rows);
  for (const render of [f.card, f.feed, f.hero]) {
    const html = render();
    assert.equal((html.match(/data-venue-dancer-profile/g) || []).length, 3);
    assert.match(html, /<strong>6<\/strong><span>Working Now<\/span>/);
  }
  assert.equal((f.hero().match(/data-grid-dancer=/g) || []).length, 6);
  assert.match(f.hero(), /Working now · 6/);
  rows[0].working = false;
  assert.match(f.feed(), /<strong>5<\/strong><span>Working Now<\/span>/);
  assert.match(f.hero(), /Working now · 5/);
  assert.equal((f.hero().match(/data-grid-dancer=/g) || []).length, 5);
});
