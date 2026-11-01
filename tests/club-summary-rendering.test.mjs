import assert from 'node:assert/strict';
import test from 'node:test';
import { clubBrandFixture } from './helpers/club-brand-render.mjs';

test('club summaries show the complete count and remaining dancers with only five green circles', () => {
  const dancers = Array.from({ length: 5 }, (_, i) => ({ id: `rank-${i}`, name: `Dancer ${i}`, venueId: 'club-one', working: true }));
  const f = clubBrandFixture({ workingNowCount: 147 }, dancers);
  for (const render of [f.card, f.feed]) {
    const html = render();
    assert.match(html, /<strong>147<\/strong><span>now<\/span>/);
    assert.match(html, /aria-label="142 more dancers working now"/);
    assert.equal((html.match(/data-working-now="true"/g) || []).length, 5);
    assert.match(html, /data-grid-profile-action="rank-0"/);
    assert.doesNotMatch(html, /Loading dancers/);
  }
});

test('All cities club previews use their summary profiles and distinguish same-name clubs by ID', () => {
  const f = clubBrandFixture({ workingNowCount: 1 });
  const market = { venues: [f.venue], pagination: { scopeKey: JSON.stringify(['clubs', '']) }, dancers: [
    { id: 'correct', name: 'Current', venueId: f.venue.id, working: true },
    { id: 'other', name: 'Other', venue: f.venue.name, venueId: 'other-city-club', working: true },
  ] };
  f.context.citySelect.value = 'All cities';
  f.context.discoveryMarket = city => city === 'All cities' ? market : { dancers: [], venues: [] };
  for (const render of [f.card, f.feed]) {
    const html = render(); assert.match(html, /data-dancer-id="correct"/); assert.doesNotMatch(html, /data-dancer-id="other"/);
  }
});
