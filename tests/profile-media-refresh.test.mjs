import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshedMediaIndex } from '../src/lib/dancr/profile-media-refresh.ts';
import { venueEmbedMediaRevision, venueEmbedMediaSnapshot } from '../src/lib/dancr/venue-embed-media.mjs';

const rows = (...ids) => ids.map(id => ({ id }));
test('a viewer stays on its current media after additions, reordering, or another item being withdrawn', () => {
  assert.equal(refreshedMediaIndex(rows('a', 'b'), rows('new', 'a', 'b'), 1), 2);
  assert.equal(refreshedMediaIndex(rows('a', 'b'), rows('b', 'a'), 1), 0);
  assert.equal(refreshedMediaIndex(rows('a', 'b'), rows('b'), 1), 0);
  assert.equal(refreshedMediaIndex(rows('a', 'b'), rows('a', 'b'), 1), 1);
});
test('withdrawn viewed media selects a remaining neighbor, or closes an empty viewer', () => {
  assert.equal(refreshedMediaIndex(rows('a', 'b', 'c'), rows('a', 'c'), 1), 1);
  assert.equal(refreshedMediaIndex(rows('a', 'b'), rows('a'), 1), 0);
  assert.equal(refreshedMediaIndex(rows('a'), [], 0), null);
});
test('the media snapshot includes display changes without exposing review or account fields', () => {
  const profile = { id: 'dancer', email: 'private', photos: [{ id: 'p', imageUrl: '/api/media/dancer-photo?id=p', focalX: 25, reviewNotes: 'private', sortOrder: 1 }] };
  const media = venueEmbedMediaSnapshot(profile, []);
  assert.equal(media.profile.email, undefined);
  assert.equal(media.profile.photos[0].reviewNotes, undefined);
  assert.equal(media.profile.photos[0].focalX, 25);
  assert.match(media.profile.photos[0].imageUrl, /^\/api\/public\/venue-embed-media\/photo/);
  const revision = venueEmbedMediaRevision(profile, []);
  for (const change of [{ focalX: 75 }, { sortOrder: 2 }, { isPinned: true }, { imageUrl: '/replacement' }]) {
    assert.notEqual(venueEmbedMediaRevision({ ...profile, photos: [{ ...profile.photos[0], ...change }] }, []), revision);
  }
  assert.equal(venueEmbedMediaRevision({ ...profile, photos: [{ ...profile.photos[0], likeCount: 500 }] }, []), revision);
});
