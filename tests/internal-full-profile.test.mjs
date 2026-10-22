import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/live-shell/app/internal-profile-bridge.js', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../src/live-shell/app/13-open-profile-modal.js', import.meta.url), 'utf8');
const modalIdentity = modalSource.slice(modalSource.indexOf('    function openProfileModal('), modalSource.indexOf('      profileModal.removeAttribute(')) + '\n}';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('Internal profiles omit Follow and Share without an empty action row; public profiles retain them', () => {
  const source = readFileSync(new URL('../src/live-shell/app/12-sync-profile-photo-viewer-window.js', import.meta.url), 'utf8');
  const actions = source.match(/    function liveProfileModalActionsMarkup\([^]*?\n    \}/)?.[0];
  assert.ok(actions);
  const context = {
    selectedCity: () => 'Las Vegas', isFollowingProfile: () => false, isWorkingTonight: () => true,
    escapeOptionValue: value => value, escapeHtml: value => value,
    profileActionButtonMarkup: (_icon, label) => label,
  };
  vm.runInNewContext(actions, context);
  for (const internalGuestProfile of [true, false]) {
    assert.equal(context.liveProfileModalActionsMarkup({ name: 'Aria', internalRoster: true, internalGuestProfile }), '');
  }
  const publicActions = context.liveProfileModalActionsMarkup({ name: 'Aria', scheduled: true });
  assert.match(publicActions, /id="followBtn"/);
  assert.match(publicActions, /data-profile-share-menu="Aria"/);
});

test('Internal initializes its viewer without loading the public directory',()=>{
  const startup=readFileSync(new URL('../src/live-shell/app/26-sync-discovery-city-scope.js',import.meta.url),'utf8');
  const branch=startup.slice(startup.lastIndexOf('    if (internalProfileFrameId) {'));
  let ready=0;
  vm.runInNewContext(branch,{internalProfileFrameId:id(1),initializeInternalProfileFrame:()=>ready++});
  assert.equal(ready,1);
  const initial=startup.slice(startup.indexOf('    const initialDiscoveryRequest ='),startup.indexOf('    const initialVenuePreviewRequest ='));
  vm.runInNewContext(initial,{internalProfileFrameId:'viewer',Promise,loadLiveDiscovery:()=>assert.fail('No city-wide discovery in a profile frame')});
  const refresh=startup.slice(startup.indexOf('    async function refreshVisibleHomeDiscovery('),startup.indexOf('    window.setInterval(',startup.indexOf('    async function refreshVisibleHomeDiscovery(')));
  vm.runInNewContext(refresh+';refreshVisibleHomeDiscovery();',{window:{},internalProfileFrameId:'viewer',loadLiveDiscovery:()=>assert.fail('No background public directory refresh')});
});
const profile = {
  id: id(1), slug: 'synthetic-dancer', stage_name: 'Synthetic dancer', city: 'Las Vegas', venueName: 'Synthetic club',
  workingUntil: new Date(Date.now() + 3600000).toISOString(), avatarRevision: 'revision',
  requestsTonight: 2, requestStatus: null,
  photos: [{ id: id(2), is_primary: true, like_count: 7 }, { id: id(3), is_pinned: true, like_count: 4 }],
  videos: [{ id: id(4), caption: 'Synthetic clip', duration_seconds: 12, like_count: 3, has_poster: true }],
  socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/synthetic' }],
};
function fixture({ external = true, staff = false, mediaFailure = false, generic = false, mediaGate = null, publicPayload = null } = {}) {
  const parent = { postMessage: (...args) => messages.push(args) }, messages = [], opens = [], fetches = [];
  const publicProfile = { id: id(1), name: 'Synthetic dancer', followerCount: 9, goingCount: 2, activeDeal: { id: 'deal' }, mainPhotoUrl: 'public-image', metricsUnavailable: false };
  const market = { dancers: external ? [publicProfile] : [] };
  const markets = { "Las Vegas": market };
  const context = {
    window: { parent, location: { search: '?internal_profile=' + (generic ? 'viewer' : id(1)), origin: 'https://example.invalid' }, addEventListener() {}, requestAnimationFrame() {}, setTimeout, clearTimeout },
    document: { body: { dataset: {}, style: { values: {}, setProperty(k,v) { this.values[k]=v; }, removeProperty(k) { delete this.values[k]; } } }, documentElement: { classList: { add() {} } }, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return {}; } },
    URLSearchParams, URL: class extends URL { static createObjectURL() { return 'blob:protected-media'; } static revokeObjectURL() {} }, AbortSignal, AbortController,
    setProfileFollowed() {}, enableProfileNotifications() {}, disableProfileNotifications() {}, goingTonightSavedByProfile: {},
    mapLiveDancer: (item, working) => ({ ...item, name: item.stageName, status: item.verified ? "Verified" : "Pending", scheduled: working, mainPhotoUrl: item.primaryPhotoUrl }),
    isWorkingTonight: item => item.locationStatus === "club_confirmed" && Date.parse(item.locationVerificationExpiresAt) > Date.now(),
    authSession: staff ? { accessToken: 'test-venue-session' } : null,
    fetch: async (url, options) => { fetches.push({ url, options }); if (mediaGate) await mediaGate(url); if (mediaFailure) throw new Error("Temporary media outage"); return { ok: true, blob: async () => ({}), json: async () => publicPayload }; },
    markets, discoveryMarket: city => markets[city], selectedCity: () => 'Las Vegas', isApprovedPublicProfile: () => true,
    modalGallery: { dataset: {}, profileVisiblePhotoCount: 1 }, PROFILE_MEDIA_PAGE_SIZE: 12,
    profilePhotoGalleryItems: profile => profile.submittedPhotos, renderProfileMediaLibrary() {}, syncProfileMediaTabCounts() {}, observeProfileMediaSentinel() {},
    loadProfileMyDancrTv() {}, setModalPhoto() {}, setProfileMainPhoto() {}, portraitClass: ()=>'portrait',
    closeProfileModal: () => context.bridge.closeInternalProfileFrame(),
    citySelect: { value: 'Las Vegas', options: [{ value: 'Las Vegas' }], append(option) { this.options.push(option); } }, openProfileModal: value => opens.push(value), showToast() {}, escapeHtml: value => String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),
  };
  vm.runInNewContext(source + '\nthis.bridge={openPublicProfileMessage,openInternalProfileMessage,closeInternalProfileFrame,startInternalProfileAuth,internalProfileMatches,sendInternalTableRequest,internalProfileRequestActionsMarkup,sendVipProfileRequest,vipProfileRequestActionsMarkup,profile:()=>internalRosterProfile};', context);
  const event = (overrides = {}) => ({ origin: 'https://example.invalid', source: parent, data: { type: 'mydancr:internal-profile-open', profile, token: staff ? '' : id(9), request: staff ? undefined : { tableLabel: 'Table 1', busy: false, message: '' } }, ...overrides });
  return { context, body: context.document.body, bridge: context.bridge, event, opens, messages, fetches, market, publicProfile, recover: () => { mediaFailure = false; } };
}

function loadRealGallery(context) {
  const helpers = {
    '03-submit-password-recovery-form.js': ['safeExternalHref', 'safeNativePhotoUrl', 'nativeResponsivePhotoAttrs', 'mobileThumbnailSource', 'normalizedReviewStatus', 'portraitClass', 'customPhotoUrl'],
    '06-rank-label.js': ['escapeOptionValue'],
    '07-shift-window-for-date.js': ['displayText'],
    '15-active-support-role.js': ['escapeHtml'],
    '20-render.js': ['safePublicMediaLikeCount'],
    '12-sync-profile-photo-viewer-window.js': ['uploadedProfilePhotoUrls', 'profilePhotoSrcSet', 'profilePhotoLikeMetadata', 'profilePhotoGalleryItems', 'profilePhotoThumbMarkup', 'galleryMarkup'],
  };
  for (const [file, names] of Object.entries(helpers)) {
    const source = readFileSync(new URL('../src/live-shell/app/' + file, import.meta.url), 'utf8');
    for (const name of names) {
      const fn = source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))?.[0];
      assert.ok(fn, name);
      vm.runInNewContext(fn, context);
    }
  }
}

test('authorized staff object URLs render real gallery images instead of black fallback tiles', async () => {
  const f = fixture({ staff: true });
  let objectIndex = 0;
  const revoked = [];
  f.context.URL.createObjectURL = () => `blob:https://example.invalid/media-${++objectIndex}`;
  f.context.URL.revokeObjectURL = url => revoked.push(url);
  await f.bridge.openInternalProfileMessage(f.event());
  loadRealGallery(f.context);
  const viewed = f.bridge.profile();
  const markup = f.context.galleryMarkup(viewed, 0);
  assert.equal((markup.match(/<img /g) || []).length, profile.photos.length);
  assert.doesNotMatch(markup, /<span class="portrait/);
  for (const photo of viewed.submittedPhotos) {
    assert.ok(markup.includes(`src="${photo.imageUrl}"`));
    assert.ok(markup.includes(`data-photo-url="${photo.imageUrl}"`), 'the full photo still opens');
    assert.equal(f.context.safeExternalHref(photo.imageUrl), '', 'object URLs are never navigation links');
  }
  assert.equal(viewed.requestsTonight, profile.requestsTonight);
  assert.equal(viewed.venue, profile.venueName);
  assert.equal(viewed.scheduled, true);
  assert.equal(f.body.dataset.internalProfileAudience, 'staff');
  const imageUrls = viewed.submittedPhotos.map(photo => photo.imageUrl);
  f.bridge.closeInternalProfileFrame();
  await Promise.resolve();
  for (const url of imageUrls) assert.ok(revoked.includes(url), 'private image URLs are released on close');
});

test('native photos accept same-origin objects and public images without widening URL or approval rules', () => {
  const f = fixture(); loadRealGallery(f.context);
  for (const url of ['blob:https://example.invalid/photo', 'https://images.example/photo.jpg']) {
    assert.equal(f.context.nativeResponsivePhotoAttrs(url), `src="${url}"`);
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'blob:https://foreign.invalid/photo', 'blob:null/photo', 'blob:invalid', 'blob:https://example.invalid/a\nb']) {
    assert.equal(f.context.nativeResponsivePhotoAttrs(url), '', url);
  }
  assert.equal(f.context.nativeResponsivePhotoAttrs('blob:https://example.invalid/"onerror="bad'), 'src="blob:https://example.invalid/&quot;onerror=&quot;bad"');
  const pending = { status: 'Verified', photoStatus: 'Approved', mainPhotoUrl: 'blob:https://example.invalid/photo',
    submittedPhotos: [{ id: 'pending', imageUrl: 'blob:https://example.invalid/photo', reviewStatus: 'pending' }] };
  assert.equal(f.context.uploadedProfilePhotoUrls(pending).length, 0, 'URL support cannot expose an unapproved photo');
  assert.match(f.context.nativeResponsivePhotoAttrs('https://images.example/master.jpg', 'https://images.example/320.jpg 320w, https://images.example/640.jpg 640w'),
    /^src="https:\/\/images.example\/320.jpg" srcset="/, 'public responsive delivery is preserved');
});

test('customer profiles use one public read, retain public actions and use MyDancr colors', async () => {
  const source = { id: id(1), slug: 'star', stageName: 'Star', city: 'Las Vegas', verified: true, venueSlug: 'spearmint-rhino',
    primaryPhotoUrl: 'https://example.invalid/photo.jpg', locationStatus: 'club_confirmed', locationVerificationExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const f = fixture({ generic: true, publicPayload: { ok: true, profile: source } });
  const event = f.event({ data: { type: 'mydancr:public-profile-open', profileId: source.id, slug: source.slug } });
  await f.bridge.openPublicProfileMessage(event);
  await f.bridge.openPublicProfileMessage(event);
  assert.deepEqual(f.opens, [source.id]);
  assert.equal(f.fetches.length, 1);
  assert.equal(f.fetches[0].url, '/api/public/dancers/star');
  assert.equal(f.fetches[0].options.headers, undefined, 'No staff authorization or media endpoint');
  assert.equal(f.bridge.profile().internalRoster, undefined, 'Normal Follow, Share, Going and media behavior remains available');
  assert.equal(f.bridge.profile().scheduled, true);
  assert.equal(f.bridge.profile().mainPhotoUrl, source.primaryPhotoUrl);
  assert.equal(f.body.dataset.internalProfileAudience, 'public');
  const modal = { dataset: {} };
  vm.runInNewContext(modalIdentity + '\nopenProfileModal("selected");', {
    citySelect: { value: source.city }, findProfile: () => f.bridge.profile(), profileModal: modal,
  });
  assert.equal(modal.dataset.venueBrand, '');
});

test('VIP profiles replace Free Entry with a queue action and update Added without reopening or fetching', async () => {
  const publicSource = { id: id(1), slug: 'aria', stageName: 'Aria', city: 'Las Vegas', verified: true };
  const f = fixture({ generic: true, publicPayload: { ok: true, profile: publicSource } });
  const event = f.event({ data: { type: 'mydancr:public-profile-open', profileId: id(1), slug: 'aria',
    vipRequest: { added: false, disabled: false, message: '' } } });
  await f.bridge.openPublicProfileMessage(event);
  const profile = f.bridge.profile();
  assert.equal(profile.vipProfile, true);
  const gridSource = readFileSync('src/live-shell/app/12-sync-profile-photo-viewer-window.js', 'utf8');
  const grid = gridSource.match(/    function profileModalGridMarkup\([^]*?\n    \}/)[0];
  vm.runInNewContext(grid, f.context);
  Object.assign(f.context, {
    shiftStatus: () => ({}), isWorkingTonight: () => false, shiftsMarkup: () => 'club',
    profileLocationStatusTile: () => '', liveProfileModalActionsMarkup: () => 'Follow Share',
    liveProfileGoingActionsMarkup: () => assert.fail('VIP must not offer I’m Going'), dancerClubDealState: () => assert.fail('VIP must not show Free Entry'),
    profileDealTileMarkup: () => assert.fail('VIP must not render a deal tile'),
    dancerProfileTonightTravelActionsMarkup: () => assert.fail('No secondary upcoming Free Entry'),
  });
  const markup = f.context.profileModalGridMarkup(profile);
  assert.match(markup, /data-vip-profile-request/); assert.match(markup, />Request<\/button>/);
  assert.match(markup, /Follow Share/);
  assert.match(markup, /profile-tonight-card is-vip-profile/);
  f.bridge.sendVipProfileRequest();
  assert.equal(f.messages.at(-1)[0].type, 'mydancr:vip-profile-request');
  assert.equal(f.messages.at(-1)[0].profileId, id(1));
  const action = { outerHTML: '' };
  f.context.document.querySelector = () => action;
  await f.bridge.openPublicProfileMessage({ ...event, data: { ...event.data, vipRequest: { added: true, disabled: false, message: '' } } });
  assert.match(action.outerHTML, /Added to request queue/);
  assert.match(action.outerHTML, /disabled/);
  assert.equal(f.fetches.length, 1); assert.equal(f.opens.length, 1);
  assert.equal(f.bridge.profile(), profile, 'keep media and scroll state mounted');
  const messages = f.messages.length;
  f.bridge.sendVipProfileRequest(); assert.equal(f.messages.length, messages);
  await f.bridge.openPublicProfileMessage({ ...event, data: { ...event.data, vipRequest: { added: false, disabled: true, message: '<unavailable>' } } });
  assert.match(action.outerHTML, /&lt;unavailable&gt;/);
  f.bridge.sendVipProfileRequest(); assert.equal(f.messages.length, messages);
  assert.equal(f.messages.some(([message]) => message.type === 'mydancr:internal-profile-close'), false);
  f.bridge.closeInternalProfileFrame();
  assert.equal(f.messages.at(-1)[0].type, 'mydancr:internal-profile-close');
  await f.bridge.openPublicProfileMessage({ ...event, data: { ...event.data, vipRequest: undefined } });
  assert.equal(f.bridge.profile().vipProfile, false, 'VIP actions must not leak into ordinary customer profiles');
  assert.equal(f.bridge.vipProfileRequestActionsMarkup(f.bridge.profile()), '');
  Object.assign(f.context, {
    liveProfileGoingActionsMarkup: () => 'I’m Going', dancerClubDealState: () => ({ key: 'none' }),
    dancerProfileTonightTravelActionsMarkup: () => '',
  });
  const customerMarkup = f.context.profileModalGridMarkup(f.bridge.profile());
  assert.match(customerMarkup, /I’m Going/);
  assert.doesNotMatch(customerMarkup, /is-vip-profile|data-vip-profile-request/);
});

test('customer viewer rejects private, unverified, mismatched and foreign profile responses', async () => {
  for (const payload of [{ ok: false }, { ok: true, profile: { id: id(2), verified: true } }, { ok: true, profile: { id: id(1), verified: false } }]) {
    const f = fixture({ generic: true, publicPayload: payload });
    const event = f.event({ data: { type: 'mydancr:public-profile-open', profileId: id(1), slug: 'star' } });
    await f.bridge.openPublicProfileMessage({ ...event, origin: 'https://foreign.invalid' });
    await f.bridge.openPublicProfileMessage({ ...event, source: {} });
    assert.equal(f.fetches.length, 0);
    await assert.rejects(f.bridge.openPublicProfileMessage(event), /Profile unavailable/);
    assert.deepEqual(f.opens, []);
    assert.equal(f.bridge.profile(), null);
  }
});

test('closing a customer profile aborts its request and ignores its late response', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ generic: true, mediaGate: () => pending, publicPayload: { ok: true, profile: { id: id(1), verified: true } } });
  const opening = f.bridge.openPublicProfileMessage(f.event({ data: { type: 'mydancr:public-profile-open', profileId: id(1), slug: 'star' } }));
  f.bridge.closeInternalProfileFrame();
  assert.equal(f.fetches[0].options.signal.aborted, true);
  release(); await opening;
  assert.deepEqual(f.opens, []);
  assert.equal(f.bridge.profile(), null);
});

test('even slow primary images cannot delay the authorized staff viewer or compete with videos', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ staff: true, mediaGate: () => pending });
  const event = f.event(); event.data.profile = { ...profile, initialPhotoUrl: 'blob:https://example.invalid/card' };
  const opening = f.bridge.openInternalProfileMessage(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.opens, [profile.id]);
  assert.equal(f.bridge.profile().mainPhotoUrl, event.data.profile.initialPhotoUrl);
  assert.ok(!f.fetches.some(item => item.url.startsWith('/api/internal/video/')));
  release(); await opening;
  assert.ok(f.fetches.some(item => item.url.startsWith('/api/internal/video/')));
});
test('staff and guest profiles use MyDancr colors while preserving club identity and profile content', async () => {
  for (const staff of [true, false]) {
    const f = fixture({ staff });
    const event = f.event(); event.data.profile = { ...profile, venueSlug: 'talk-of-the-town', internalAccent: '#c99842' };
    await f.bridge.openInternalProfileMessage(event);
    const viewed = f.bridge.profile();
    const modal = { dataset: { venueBrand: 'talk-of-the-town' } };
    vm.runInNewContext(modalIdentity + '\nopenProfileModal("selected");', {
      citySelect: { value: profile.city }, findProfile: () => viewed, profileModal: modal,
    });
    assert.equal(modal.dataset.venueBrand, staff ? '' : 'talk-of-the-town');
    assert.equal(viewed.venueSlug, 'talk-of-the-town', 'Changing colors must preserve the actual club identity');
    assert.equal(viewed.submittedPhotos.length, profile.photos.length);
    assert.equal(viewed.internalVideos.length, profile.videos.length);
    assert.equal(viewed.socials.instagram, profile.socialLinks[0].url);
    assert.equal(f.body.dataset.venueGuestColor, undefined);
    assert.equal(f.body.style.values['--venue-guest-accent'], undefined);
    assert.equal(f.body.style.values['--venue-guest-on-accent'], undefined);
    await f.bridge.openInternalProfileMessage(f.event());
    assert.equal(f.body.dataset.venueGuestColor, undefined);
    assert.equal(f.body.style.values['--venue-guest-accent'], undefined);
    event.data.profile = { ...profile, internalAccent: 'red;display:none' };
    await f.bridge.openInternalProfileMessage(event);
    assert.equal(f.body.dataset.venueGuestColor, undefined);
  }
});

test('Internal opens the exact discovery viewer with canonical identity, gallery, videos and socials', async () => {
  const f = fixture(), before = JSON.stringify(f.market);
  await f.bridge.openInternalProfileMessage(f.event());
  assert.deepEqual(f.opens, [id(1)]);
  const viewed = f.bridge.profile();
  assert.equal(viewed.slug, profile.slug); assert.equal(viewed.name, profile.stage_name);
  assert.equal(viewed.followerCount, 9); assert.equal(viewed.goingCount, 2);
  assert.equal(viewed.submittedPhotos.length, 2); assert.equal(viewed.internalVideos.length, 1);
  assert.equal(viewed.internalVideos[0].durationSeconds, 12);
  const poster = new URL(viewed.internalVideos[0].posterUrl);
  assert.equal(poster.origin, 'https://example.invalid');
  assert.equal(poster.pathname, '/api/internal/video-poster/' + id(4));
  assert.equal(poster.searchParams.get('token'), id(9));
  assert.equal(viewed.socials.instagram, profile.socialLinks[0].url);
  assert.match(viewed.mainPhotoUrl, /\/api\/internal\/photo\//);
  assert.match(viewed.mainPhotoUrl, /^https:\/\/example\.invalid\//, 'The shared media sanitizer accepts absolute scoped URLs');
  assert.equal(viewed.mainPhotoSrcSet, ''); assert.equal(viewed.avatarPhotoSrcSet, '');
  assert.equal(viewed.activeDeal, null); assert.equal(viewed.activeDeals.length, 0);
  assert.equal(JSON.stringify(f.market), before, 'Private context never changes discovery');
  assert.equal(viewed.hidden, true);
});
test('Internal-only dancers open through the same viewer without joining public discovery', async () => {
  const f=fixture({external:false}); await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.opens.length,1); assert.equal(f.market.dancers.length,0);
  assert.equal(f.bridge.internalProfileMatches(id(1)).name, profile.stage_name);
  assert.equal(f.bridge.profile().metricsUnavailable,true);
});

test('a club in another city opens in its own city without loading a public directory', async () => {
  const f = fixture(), event = f.event();
  event.data.profile = { ...profile, city: 'Austin', slug: '' };
  await f.bridge.openInternalProfileMessage(event);
  assert.equal(f.bridge.profile().city, 'Austin');
  assert.equal(f.context.citySelect.value, 'Austin');
  assert.equal(f.context.markets.Austin.dancers.length, 0);
  assert.equal(f.fetches.length, 0);
});

test('only the selected profile public metrics load, without exposing its club token', async () => {
  const f = fixture({ external: false }), requests = [];
  f.context.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ profile: { id: profile.id, followerCount: 17, profileViewsToday: 42, metricsUnavailable: false } }) };
  };
  await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/public/dancers/synthetic-dancer');
  assert.doesNotMatch(JSON.stringify(requests), /token|authorization/);
  assert.equal(f.bridge.profile().followerCount, 17);
  assert.equal(f.bridge.profile().profileViewsToday, 42);
  assert.equal(f.opens.length, 1);
  assert.equal(f.market.dancers.length, 0);
});
test('wrong origin, unrelated frame, or wrong dancer messages are ignored', async () => {
  const f=fixture();
  await f.bridge.openInternalProfileMessage(f.event({origin:'https://untrusted.invalid'}));
  await f.bridge.openInternalProfileMessage(f.event({source:{}}));
  await f.bridge.openInternalProfileMessage(f.event({data:{type:'mydancr:internal-profile-open',profile:{...profile,id:id(99)}}}));
  assert.equal(f.opens.length,0);
});
test('unchanged roster refreshes preserve the open photo/video viewer', async () => {
  const f=fixture(); await f.bridge.openInternalProfileMessage(f.event()); await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.opens.length,1);
});

test('changed likes, names and working status update without reopening or resetting the gallery', async () => {
  const f = fixture();
  await f.bridge.openInternalProfileMessage(f.event());
  f.context.modalGallery.profileVisiblePhotoCount = 30;
  const updated = f.event();
  updated.data.profile = { ...profile, stage_name: 'Updated name', workingUntil: null, requestsTonight: 8,
    photos: profile.photos.map(photo => ({ ...photo, like_count: 10 })) };
  await f.bridge.openInternalProfileMessage(updated);
  assert.equal(f.opens.length, 1, 'No openProfileModal call that resets tabs, playback and scroll');
  assert.equal(f.bridge.profile().name, 'Updated name');
  assert.equal(f.bridge.profile().scheduled, false);
  assert.equal(f.bridge.profile().requestsTonight, 8);
  assert.equal(f.bridge.profile().submittedPhotos[0].likeCount, 10);
  assert.match(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()), /disabled/);
});

test('slow gallery and video downloads do not delay showing the staff profile', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ staff: true, mediaGate: url => url.endsWith(id(3)) || url.endsWith(id(4)) ? gate : undefined });
  const opening = f.bridge.openInternalProfileMessage(f.event());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.opens, [profile.id]);
  assert.equal(f.messages.at(-1)[0].type, 'mydancr:internal-profile-shown');
  assert.equal(f.messages.at(-1)[0].profileId, profile.id);
  assert.equal(f.bridge.profile().submittedPhotos.length, 1);
  assert.equal(f.bridge.profile().internalVideos.length, 0);
  release(); await opening;
  assert.equal(f.bridge.profile().submittedPhotos.length, 2);
  assert.equal(f.bridge.profile().internalVideos.length, 1);
  assert.equal(f.opens.length, 1, 'Appending media must not reopen the profile');
});

test('closing aborts private downloads and a late result cannot repopulate the reusable viewer', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ staff: true, generic: true, mediaGate: () => gate });
  const opening = f.bridge.openInternalProfileMessage(f.event());
  await new Promise(resolve => setImmediate(resolve));
  f.bridge.closeInternalProfileFrame();
  assert.ok(f.fetches.every(request => request.options.signal.aborted));
  release(); await opening;
  assert.equal(f.bridge.profile(), null);
  assert.equal(f.opens.length, 1, "late media cannot reopen the closed viewer");
  await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.bridge.profile().id, profile.id);
  assert.equal(f.opens.length, 2);
  const next = f.event(); next.data.profile = { ...profile, id: id(5), slug: '' };
  await f.bridge.openInternalProfileMessage(next);
  assert.equal(f.bridge.profile().id, id(5));
  assert.equal(f.bridge.internalProfileMatches(profile.id), null);
  assert.deepEqual(f.opens, [profile.id, profile.id, id(5)]);
});

test('the reusable viewer still requires its same-origin parent and a valid dancer ID', async () => {
  const f = fixture({ generic: true });
  await f.bridge.openInternalProfileMessage(f.event({ origin: 'https://foreign.invalid' }));
  await f.bridge.openInternalProfileMessage(f.event({ source: {} }));
  const invalid = f.event(); invalid.data.profile = { ...profile, id: 'invalid' };
  await f.bridge.openInternalProfileMessage(invalid);
  assert.equal(f.opens.length, 0);
});
test('staff media uses authenticated requests and blob URLs without exposing storage links', async () => {
  const f=fixture({staff:true}); await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.fetches.length,5);
  assert.ok(f.fetches.every(item=>item.options.headers.authorization==='Bearer test-venue-session' && item.options.cache==='no-store'));
  assert.ok(f.fetches.every(item=>!item.url.includes('token=')));
  assert.equal(f.bridge.profile().mainPhotoUrl,'blob:protected-media');
  assert.equal(f.bridge.profile().internalVideos[0].posterUrl,'blob:protected-media');
  assert.ok(f.fetches.some(item => item.url === '/api/internal/video-poster/' + id(4)));
});

test('videos without an approved poster retain playback without requesting a missing image', async () => {
  const f=fixture({staff:true}), event=f.event();
  event.data.profile={...profile,videos:profile.videos.map(video=>({...video,has_poster:false}))};
  await f.bridge.openInternalProfileMessage(event);
  assert.equal(f.fetches.length,4);
  assert.equal(f.bridge.profile().internalVideos[0].posterUrl,'');
  assert.equal(f.bridge.profile().internalVideos[0].videoUrl,'blob:protected-media');
});
test('closing the shared viewer returns control to the roster and clears private context', async () => {
  const f=fixture(); await f.bridge.openInternalProfileMessage(f.event()); f.bridge.closeInternalProfileFrame();
  assert.equal(f.bridge.profile(),null);
  assert.equal(f.messages.at(-1)[0].type,'mydancr:internal-profile-close');
});

test('signup and sign-in hand off to the parent without closing the embedded profile', async () => {
  for (const mode of ['signup', 'login']) {
    const f = fixture();
    await f.bridge.openInternalProfileMessage(f.event());
    const handlers = readFileSync(new URL('../src/live-shell/app/23-events.js', import.meta.url), 'utf8');
    const name = mode === 'signup' ? 'accountRequiredCreateLink' : 'accountRequiredSignInLink';
    const start = handlers.indexOf(`    ${name}?.addEventListener`);
    const handler = handlers.slice(start, handlers.indexOf('\n    });', start) + 7);
    let click;
    vm.runInNewContext(handler, {
      [name]: { addEventListener: (_name, fn) => { click = fn; } },
      startInternalProfileAuth: f.bridge.startInternalProfileAuth,
      closeProfileModal: () => assert.fail('The iframe must stay alive until its parent navigates'),
      closeAccountRequiredPrompt: () => assert.fail('Keep a usable prompt if storage is unavailable'),
    });
    click({ preventDefault() {} });
    assert.equal(f.messages.at(-1)[0].type, 'mydancr:internal-profile-auth');
    assert.equal(f.messages.at(-1)[0].mode, mode);
    assert.equal(f.messages.at(-1)[0].profileId, id(1));
    assert.equal(f.messages.at(-1)[1], 'https://example.invalid');
    assert.ok(f.bridge.profile());
  }
});

test('profile requests send one parent action, then share the confirmed status without resetting media', async () => {
  const f=fixture(); await f.bridge.openInternalProfileMessage(f.event());
  assert.match(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()), /Request at Table 1/);
  f.bridge.sendInternalTableRequest(); f.bridge.sendInternalTableRequest();
  assert.equal(f.messages.filter(([message])=>message.type==='mydancr:internal-table-request').length,1);
  const updated=f.event(); updated.data.profile={...profile,requestsTonight:3,requestStatus:'pending',requestId:id(8)}; updated.data.request.confirmed=true;
  await f.bridge.openInternalProfileMessage(updated);
  assert.equal(f.opens.length,1,'Request status must not reset an open gallery');
  assert.equal(f.bridge.profile().requestsTonight,3);
  assert.match(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()), /disabled aria-busy="false"><span class="internal-request-sent-label">Request sent</);
  f.bridge.sendInternalTableRequest();
  assert.equal(f.messages.filter(([message])=>message.type==='mydancr:internal-table-request').length,1);
});

test('staff profiles show no guest table request action', async () => {
  const f=fixture({staff:true});await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()),'');
  f.bridge.sendInternalTableRequest();
  assert.equal(f.messages.some(([message])=>message.type==='mydancr:internal-table-request'),false);
});

test('full-profile cancellation uses the exact request, blocks duplicates, and preserves the gallery', async()=>{
 const f=fixture(),event=f.event();event.data.profile={...profile,requestStatus:'acknowledged',requestId:id(8)};
 await f.bridge.openInternalProfileMessage(event);
 assert.match(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()),/>Cancel request</);
 assert.match(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()),/data-request-sent/);
 f.bridge.sendInternalTableRequest();f.bridge.sendInternalTableRequest();
 const cancel=f.messages.filter(([message])=>message.type==='mydancr:internal-table-cancel');
 assert.equal(cancel.length,1);assert.equal(cancel[0][0].profileId,profile.id);assert.equal(cancel[0][0].requestId,id(8));
 assert.match(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()),/disabled aria-busy="true">Cancelling…/);
 await f.bridge.openInternalProfileMessage(f.event());
 assert.equal(f.opens.length,1,'Cancelling must not reset the media viewer');
 assert.match(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()),/>Request at Table 1</);
 assert.doesNotMatch(f.bridge.internalProfileRequestActionsMarkup(f.bridge.profile()),/data-request-sent/);
});

test('Internal replaces Going with actual requests and retains Views today while External keeps its metrics', () => {
  const script=readFileSync(new URL('../src/live-shell/app/12-sync-profile-photo-viewer-window.js',import.meta.url),'utf8');
  const renderer=script.slice(script.indexOf('    function profileActivityMetricsMarkup('),script.indexOf('    function dancerProfileDirectionsMarkup('));
  const context={followerNumber:()=>9,selectedCity:()=>'',tonightInterestCount:()=>999,profileViewsToday:()=>888};
  vm.runInNewContext(renderer+'\nthis.render=profileActivityMetricsMarkup;',context);
  const internal=context.render({internalRoster:true,requestsTonight:2}),external=context.render({});
  assert.match(internal,/internalRequestsTonight[^>]*>2</);assert.match(internal,/Requests tonight/);
  assert.doesNotMatch(internal,/Going|999/);
  assert.match(internal,/modalProfileViews[^>]*>888</);assert.match(internal,/Views today/);
  assert.match(context.render({internalRoster:true,requestsTonight:2,metricsUnavailable:true}),/modalProfileViews[^>]*>—</);
  assert.match(external,/Going/);assert.match(external,/Views today/);assert.doesNotMatch(external,/Requests tonight/);
});
test('the same profile renderer omits Club Deals only for Internal context', () => {
  const script=readFileSync(new URL('../src/live-shell/app/12-sync-profile-photo-viewer-window.js',import.meta.url),'utf8');
  const renderer=script.slice(script.indexOf('    function profileModalGridMarkup('),script.indexOf('    function profileActionButtonMarkup('));
  const context={shiftStatus:()=>({}),selectedCity:()=>'',socialLinksMarkup:()=>'',dancerClubDealState:()=>({key:'available'}),
    profileDealTileMarkup:()=>'<div data-club-deal>Free Entry</div>',dancerProfileTonightTravelActionsMarkup:()=>'',isWorkingTonight:()=>true,
    liveProfileModalActionsMarkup:()=>'<button>Follow</button><button>Share</button>',escapeHtml:v=>v,shiftsMarkup:()=>'<p>Working now</p>',
    liveProfileGoingActionsMarkup:()=>'<button>I’m Going</button>',internalProfileRequestActionsMarkup:()=>'<button>Request at Table 1</button>',internalProfileTableRequestMarkup:()=>'',internalProfileRosterStatusMarkup:()=>'',profileLocationStatusTile:()=>''};
  vm.runInNewContext(renderer+'\nthis.render=profileModalGridMarkup;',context);
  const external=context.render({scheduled:true}),internal=context.render({scheduled:true,internalRoster:true});
  assert.match(external,/data-club-deal/); assert.doesNotMatch(internal,/data-club-deal|Free Entry|profile-tonight-deal/);
  for(const label of ['Follow','Share','Working now']) assert.ok(external.includes(label)&&internal.includes(label));
  assert.match(internal,/Request at Table 1/);assert.doesNotMatch(internal,/I’m Going/);assert.match(external,/I’m Going/);
});


test('staff table context matches the clicked request and updates without reloading media', async () => {
  const f = fixture({ staff: true });
  const contextNode = { outerHTML: '' };
  f.context.document.querySelector = selector => selector === '.internal-profile-table-context' ? contextNode : null;
  const event = f.event();
  event.data.profile = { ...profile, tableRequest: { id: 'request-one', tableLabel: 'Table <7>', state: 'pending' } };
  await f.bridge.openInternalProfileMessage(event);
  const reads = f.fetches.length;
  for (const [state, label] of [['pending', 'New request'], ['acknowledged', 'Seen by staff'], ['arrived', 'Arrived at table'], ['closed', 'Request closed']]) {
    event.data.profile = { ...profile, tableRequest: { id: 'request-one', tableLabel: 'Table <7>', state } };
    await f.bridge.openInternalProfileMessage(event);
    assert.ok(contextNode.outerHTML.includes(label));
    assert.match(contextNode.outerHTML, /Table &lt;7&gt;/);
    assert.equal(f.bridge.profile().scheduled, true, 'request status does not alter working status');
    assert.equal(f.fetches.length, reads, 'status-only updates do not reload private media');
    assert.equal(f.opens.length, 1, 'keep the open profile and media position');
  }
  event.data.profile = profile;
  await f.bridge.openInternalProfileMessage(event);
  assert.equal(contextNode.outerHTML, '', 'the roster profile clears the previous request context');
  assert.equal(f.context.internalProfileTableRequestMarkup({ ...f.bridge.profile(), tableRequest: { state: 'unexpected', tableLabel: 'Table 1' } }), '');
});

test('staff table context is never shown in table guest or public profiles', async () => {
  const f = fixture();
  const event = f.event();
  event.data.profile = { ...profile, tableRequest: { id: 'request-one', tableLabel: 'Table 7', state: 'pending' } };
  await f.bridge.openInternalProfileMessage(event);
  assert.equal(f.bridge.profile().tableRequest, null);
  for (const view of [f.bridge.profile(), { tableRequest: event.data.profile.tableRequest }]) {
    assert.equal(f.context.internalProfileTableRequestMarkup(view), '');
  }
});

test('staff roster visibility matches the card and updates without reloading media', async () => {
  const f = fixture({ staff: true });
  const statusNode = { outerHTML: '' };
  f.context.document.querySelector = selector => selector === '.internal-profile-roster-status' ? statusNode : null;
  const event = f.event();
  event.data.profile = { ...profile, rosterStatus: 'Internal only' };
  await f.bridge.openInternalProfileMessage(event);
  const reads = f.fetches.length;
  for (const rosterStatus of ['Internal only', 'External only', 'Internal + External', 'Affiliated']) {
    event.data.profile = { ...profile, rosterStatus };
    await f.bridge.openInternalProfileMessage(event);
    assert.match(statusNode.outerHTML, /role="status"/);
    assert.ok(statusNode.outerHTML.includes(rosterStatus));
    assert.equal(f.bridge.profile().rosterStatus, rosterStatus);
    assert.equal(f.fetches.length, reads);
    assert.equal(f.opens.length, 1);
  }
  for (const rosterStatus of [null, undefined, '<script>unknown</script>']) {
    event.data.profile = { ...profile, rosterStatus };
    await f.bridge.openInternalProfileMessage(event);
    assert.equal(statusNode.outerHTML, '', 'unknown or absent status does not carry over from another card');
  }
  const guest = fixture();
  const guestEvent = guest.event();
  guestEvent.data.profile = { ...profile, rosterStatus: 'Internal only' };
  await guest.bridge.openInternalProfileMessage(guestEvent);
  assert.equal(guest.bridge.profile().rosterStatus, null);
  assert.equal(f.context.internalProfileRosterStatusMarkup({ rosterStatus: 'Internal only' }), '', 'public profiles omit staff roster details');
});

test('staff media recovers on an unchanged profile refresh after a temporary outage', async () => {
  const f = fixture({staff:true,mediaFailure:true});
  await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.bridge.profile().mainPhotoUrl,'');
  const failed = f.fetches.length;
  f.recover(); await f.bridge.openInternalProfileMessage(f.event());
  assert.ok(f.fetches.length > failed);
  assert.equal(f.bridge.profile().mainPhotoUrl,'blob:protected-media');
  const recovered = f.fetches.length;
  await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.fetches.length,recovered,'A complete unchanged profile must preserve the viewer');
});
