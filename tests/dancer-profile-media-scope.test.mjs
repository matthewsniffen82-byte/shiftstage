import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const now = Date.parse('2026-10-29T06:00:00Z');
class Clock extends Date { static now() { return now; } }
function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, Date: Clock, URL, URLSearchParams, console,
    require: name => dependencies[name] || {} });
  return exports;
}
const presence = load('src/lib/dancr/shift-presence.ts');
const scope = load('src/lib/dancr/dancer-profile-media-scope.ts', { './shift-presence': presence });
const permissions = load('src/lib/dancr/club-media-permissions.ts');
const clubA = '10000000-0000-4000-8000-000000000001';
const clubB = '10000000-0000-4000-8000-000000000002';
const shift = (venueId, changes = {}) => ({ id: venueId, venueId, venueSlug: 'club', status: 'posted',
  checkedInAt: '2026-10-29T05:00:00Z', locationStatus: 'club_confirmed',
  locationVerificationExpiresAt: '2026-10-29T11:00:00Z', ...changes });
const profile = shifts => ({ id: 'dancer', slug: 'fixture', city: 'Las Vegas', upcomingShifts: shifts,
  primaryPhotoUrl: 'a.jpg', avatarPhotoUrl: 'a.jpg', galleryPhotoIds: ['a', 'b', 'both'],
  galleryPhotoUrls: ['a.jpg', 'b.jpg', 'both.jpg'], photos: [{ id: 'a' }, { id: 'b' }, { id: 'both' }] });

test('ordinary links follow A, then B, then A using the current verified check-in', () => {
  for (const id of [clubA, clubB, clubA]) assert.equal(scope.dancerProfileMediaVenue(profile([shift(id)])), id);
});
for (const [name, changes] of [
  ['expired', { locationVerificationExpiresAt: '2026-10-29T06:00:00Z' }],
  ['checked out', { checkedOutAt: '2026-10-29T05:30:00Z' }],
  ['cancelled', { status: 'cancelled' }], ['scheduled', { checkedInAt: null }],
  ['unverified', { locationStatus: 'self_reported' }], ['invalid expiry', { locationVerificationExpiresAt: 'invalid' }],
]) test(`${name} shifts and old affiliations cannot select a club's media`, () => {
  assert.equal(scope.dancerProfileMediaVenue({ ...profile([shift(clubA, changes)]), venueId: clubA }), undefined);
  assert.equal(scope.dancerProfileMediaVenue(profile([shift(clubA, changes), shift(clubB)])), clubB);
});
test('explicit club links retain their club and missing profiles remain missing', () => {
  assert.equal(scope.dancerProfileMediaVenue(profile([shift(clubB)]), clubA), clubA);
  assert.equal(scope.dancerProfileMediaVenue(null), undefined);
});

function fixture(initial = profile([shift(clubA)]), { empty = false, fail = false } = {}) {
  let current = initial;
  const lookups = [], videoReads = [];
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'club_public_media'); lookups.push(args.p_venue_id);
    if (fail) return { error: new Error('permissions unavailable') };
    return { data: empty ? [] : [args.p_venue_id === clubA ? 'a' : 'b', 'both'].map(photoId => ({ dancerId: 'dancer', photoId })) };
  } };
  const dependencies = {
    '@/src/lib/dancr/dancer-profile-media-scope': scope, './dancer-profile-media-scope': scope,
    '@/src/lib/dancr/shift-presence': presence,
    '@/src/lib/dancr/club-media-permissions': permissions,
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => client },
    '@/src/lib/dancr/public': { getDancerProfile: async () => current, getVenueProfile: async () => null },
    '@/src/lib/dancr/public-cache-policy': { PUBLIC_DYNAMIC_CACHE_CONTROL: 'private, no-store' },
    '@/src/lib/dancr/safe-return-path': { safeLocalReturnPath: value => value || '' },
    '@/src/lib/dancr/deals': { getActiveClubDealsForVenue: async () => [] },
    '@/src/lib/dancr/public-club-deal': { toPublicClubDeal: deal => deal },
    '@/src/lib/dancr/tv': { getPublicMyDancrTvFeed: async (_, options) => {
      videoReads.push(options.venueId); return [{ id: options.venueId === clubA ? 'video-a' : 'video-b', videoUrl: 'approved-video' }];
    } },
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, headers: options.headers }) } },
    '@/src/lib/api': { apiError: () => ({ status: 500 }) },
    'next/navigation': { notFound() { throw new Error('not found'); }, permanentRedirect(href) { throw Object.assign(new Error('redirect'), { href }); } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  };
  const content = load('src/lib/dancr/public-dancer-content.ts', dependencies);
  dependencies['@/src/lib/dancr/public-dancer-content'] = content;
  const page = load('app/dancers/[slug]/page.tsx', dependencies).default;
  const api = load('app/api/public/dancers/[slug]/route.ts', dependencies).GET;
  return { lookups, videoReads, content, client, set: next => { current = next; },
    page: (params = {}) => page({ params: Promise.resolve({ slug: 'fixture' }), searchParams: Promise.resolve(params) }),
    api: (query = '') => api({ url: 'https://example.invalid/api/public/dancers/fixture' + query }, { params: Promise.resolve({ slug: 'fixture' }) }) };
}

test('page and JSON automatically switch photos, main and avatar for A/B/A without changing saved media', async () => {
  const f = fixture();
  for (const [club, main] of [[clubA, 'a'], [clubB, 'b'], [clubA, 'a']]) {
    const original = profile([shift(club)]); f.set(original);
    const page = await f.page(), response = await f.api();
    for (const result of [page.props.profile, response.body.profile]) {
      assert.equal(result.primaryPhotoUrl, main + '.jpg'); assert.equal(result.avatarPhotoUrl, main + '.jpg');
      assert.deepEqual(Array.from(result.photos, photo => photo.id), [main, 'both']);
    }
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(original.galleryPhotoIds, ['a', 'b', 'both']);
    assert.equal(original.primaryPhotoUrl, 'a.jpg');
    assert.equal(page.props.tvVideos[0].id, club === clubA ? 'video-a' : 'video-b');
  }
  assert.deepEqual(f.videoReads, [clubA, clubB, clubA]);
});
test('explicit club context overrides active check-in for both photos and videos', async () => {
  const f = fixture(profile([shift(clubB)]));
  const page = await f.page({ venue: clubA }), api = await f.api('?venue=' + clubA);
  assert.equal(page.props.profile.primaryPhotoUrl, 'a.jpg'); assert.equal(api.body.profile.primaryPhotoUrl, 'a.jpg');
  assert.deepEqual(f.videoReads, [clubA]);
});

test('public page and API retain the saved face crop only at clubs approving its source photo',async()=>{
 const f=fixture();
 for(const [club,expected] of [[clubA,'face-crop.jpg'],[clubB,'b.jpg'],[clubA,'face-crop.jpg']]){
  f.set({...profile([shift(club)]),avatarPhotoUrl:'face-crop.jpg',avatarPhotoSrcSet:'face-set',avatarPhotoFocalX:42,avatarPhotoFocalY:35,avatarSourcePhotoId:'a'});
  for(const result of [(await f.page()).props.profile,(await f.api()).body.profile]){
   assert.equal(result.avatarPhotoUrl,expected);
   if(club===clubA){assert.equal(result.avatarPhotoSrcSet,'face-set');assert.equal(result.avatarPhotoFocalX,42);assert.equal(result.avatarPhotoFocalY,35);}
   else {assert.equal(result.avatarSourcePhotoId,null);assert.equal(result.avatarPhotoFocalY,50);}
  }
 }
});
test('off-shift personal profiles remain available without borrowing old club approval', async () => {
  const original = { ...profile([]), venueId: clubA }, f = fixture(original);
  assert.equal((await f.page()).props.profile, original);
  assert.deepEqual(Array.from((await f.api()).body.profile.photos, photo => photo.id), ['a', 'b', 'both']);
  assert.deepEqual(f.lookups, []); assert.deepEqual(f.videoReads, [undefined]);
});
test('no allowed photos and permission lookup failures never expose the unfiltered profile', async () => {
  for (const options of [{ empty: true }, { fail: true }]) {
    const f = fixture(profile([shift(clubB)]), options);
    await assert.rejects(f.page()); assert.equal((await f.api()).status, options.fail ? 500 : 404);
    assert.equal(f.videoReads.length, 0);
  }
});
test('invalid club links are rejected before a permission lookup', async () => {
  const f = fixture(); await assert.rejects(f.page({ venue: 'invalid' }), /not found/);
  assert.equal((await f.api('?venue=invalid')).status, 400); assert.equal(f.lookups.length, 0);
});
test('video content resolves active club even when its caller supplies no club', async () => {
  const f = fixture(); await f.content.loadPublicDancerContent(f.client, profile([shift(clubB)]));
  assert.deepEqual(f.videoReads, [clubB]);
});
test('canonical redirects preserve explicit context without pinning an automatic check-in', async () => {
  const f = fixture({ ...profile([shift(clubB)]), slug: 'canonical' });
  await assert.rejects(f.page(), error => error.href === '/dancers/canonical');
  await assert.rejects(f.page({ venue: clubA }), error => error.href === '/dancers/canonical?venue=' + clubA);
});
