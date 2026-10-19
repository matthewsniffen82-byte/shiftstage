import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = ['12-sync-profile-photo-viewer-window', '22-create-home-tv-landing-preloader', '07-shift-window-for-date']
  .map(name => readFileSync(new URL(`../src/live-shell/app/${name}.js`, import.meta.url), 'utf8')).join('\n');
const extract = name => {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n    function ', start + 10));
};
const rhino = { id: '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af', slug: 'talk-of-the-town', name: 'Spearmint Rhino Las Vegas' };

test('profile club buttons resolve the assigned venue even when names collide', () => {
  const context = vm.createContext({
    displayText: String, escapeOptionValue: String, venueIconMarkup: () => '',
    citySelect: { value: 'Las Vegas' }, selectedCity: () => 'Las Vegas', URLSearchParams,
    slugify: value => value.toLowerCase().replaceAll(' ', '-'),
    discoveryMarket: () => ({ venues: [{ id: 'other-club', slug: 'other-club', name: rhino.name }, rhino] }),
  });
  for (const name of ['profileVenueDestinationMarkup', 'resolveVenueByName', 'venueExperienceHref']) vm.runInContext(extract(name), context);
  for (const identifiers of [{ venueId: rhino.id, venueSlug: rhino.slug }, { venueSlug: rhino.slug }]) {
    const markup = context.profileVenueDestinationMarkup({ venue: rhino.name, ...identifiers }, { live: true });
    const reference = markup.match(/data-open-venue="([^"]+)"/)[1];
    assert.equal(context.resolveVenueByName(reference).id, rhino.id);
  }
  assert.equal(context.resolveVenueByName('spearmint-rhino-las-vegas-demo').id, rhino.id);
  assert.equal(context.resolveVenueByName('11fd5e46-d24f-4a02-87f6-2aa18b0876ae').id, rhino.id);
  const href = new URL(context.venueExperienceHref(rhino), 'https://mydancr.com');
  assert.equal(href.searchParams.get('venue'), rhino.slug);
  assert.equal(href.searchParams.get('city'), 'Las Vegas');
});
