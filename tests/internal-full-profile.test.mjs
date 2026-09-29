import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/live-shell/app/internal-profile-bridge.js', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = {
  id: id(1), slug: 'synthetic-dancer', stage_name: 'Synthetic dancer', city: 'Las Vegas', venueName: 'Synthetic club',
  workingUntil: new Date(Date.now() + 3600000).toISOString(), avatarRevision: 'revision',
  photos: [{ id: id(2), is_primary: true, like_count: 7 }, { id: id(3), is_pinned: true, like_count: 4 }],
  videos: [{ id: id(4), caption: 'Synthetic clip', duration_seconds: 12, like_count: 3 }],
  socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/synthetic' }],
};
function fixture({ external = true, staff = false } = {}) {
  const parent = { postMessage: (...args) => messages.push(args) }, messages = [], opens = [], fetches = [];
  const publicProfile = { id: id(1), name: 'Synthetic dancer', followerCount: 9, goingCount: 2, activeDeal: { id: 'deal' }, mainPhotoUrl: 'public-image', metricsUnavailable: false };
  const market = { dancers: external ? [publicProfile] : [] };
  const context = {
    window: { parent, location: { search: '?internal_profile=' + id(1), origin: 'https://example.invalid' }, addEventListener() {} },
    document: { documentElement: { classList: { add() {} } } },
    URLSearchParams, URL: class extends URL { static createObjectURL() { return 'blob:protected-media'; } static revokeObjectURL() {} }, AbortSignal,
    authSession: staff ? { accessToken: 'test-venue-session' } : null,
    fetch: async (url, options) => { fetches.push({ url, options }); return { ok: true, blob: async () => ({}) }; },
    discoveryMarket: () => market, selectedCity: () => 'Las Vegas', isApprovedPublicProfile: () => true,
    citySelect: { value: 'Las Vegas' }, openProfileModal: value => opens.push(value), showToast() {},
  };
  vm.runInNewContext(source + '\nthis.bridge={openInternalProfileMessage,closeInternalProfileFrame,internalProfileMatches,profile:()=>internalRosterProfile};', context);
  const event = (overrides = {}) => ({ origin: 'https://example.invalid', source: parent, data: { type: 'mydancr:internal-profile-open', profile, token: staff ? '' : id(9) }, ...overrides });
  return { bridge: context.bridge, event, opens, messages, fetches, market, publicProfile };
}
test('Internal opens the exact discovery viewer with canonical identity, gallery, videos and socials', async () => {
  const f = fixture(), before = JSON.stringify(f.market);
  await f.bridge.openInternalProfileMessage(f.event());
  assert.deepEqual(f.opens, [id(1)]);
  const viewed = f.bridge.profile();
  assert.equal(viewed.slug, profile.slug); assert.equal(viewed.name, profile.stage_name);
  assert.equal(viewed.followerCount, 9); assert.equal(viewed.goingCount, 2);
  assert.equal(viewed.submittedPhotos.length, 2); assert.equal(viewed.internalVideos.length, 1);
  assert.equal(viewed.internalVideos[0].durationSeconds, 12);
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
test('staff media uses authenticated requests and blob URLs without exposing storage links', async () => {
  const f=fixture({staff:true}); await f.bridge.openInternalProfileMessage(f.event());
  assert.equal(f.fetches.length,4);
  assert.ok(f.fetches.every(item=>item.options.headers.authorization==='Bearer test-venue-session' && item.options.cache==='no-store'));
  assert.ok(f.fetches.every(item=>!item.url.includes('token=')));
  assert.equal(f.bridge.profile().mainPhotoUrl,'blob:protected-media');
});
test('closing the shared viewer returns control to the roster and clears private context', async () => {
  const f=fixture(); await f.bridge.openInternalProfileMessage(f.event()); f.bridge.closeInternalProfileFrame();
  assert.equal(f.bridge.profile(),null);
  assert.equal(f.messages.at(-1)[0].type,'mydancr:internal-profile-close');
});
test('the same profile renderer omits Club Deals only for Internal context', () => {
  const script=readFileSync(new URL('../src/live-shell/app/12-sync-profile-photo-viewer-window.js',import.meta.url),'utf8');
  const renderer=script.slice(script.indexOf('    function profileModalGridMarkup('),script.indexOf('    function profileActionButtonMarkup('));
  const context={shiftStatus:()=>({}),selectedCity:()=>'',socialLinksMarkup:()=>'',dancerClubDealState:()=>({key:'available'}),
    profileDealTileMarkup:()=>'<div data-club-deal>Free Entry</div>',dancerProfileTonightTravelActionsMarkup:()=>'',isWorkingTonight:()=>true,
    liveProfileModalActionsMarkup:()=>'<button>Follow</button><button>Share</button>',escapeHtml:v=>v,shiftsMarkup:()=>'<p>Working now</p>',
    liveProfileGoingActionsMarkup:()=>'<button>I’m Going</button>',profileLocationStatusTile:()=>''};
  vm.runInNewContext(renderer+'\nthis.render=profileModalGridMarkup;',context);
  const external=context.render({scheduled:true}),internal=context.render({scheduled:true,internalRoster:true});
  assert.match(external,/data-club-deal/); assert.doesNotMatch(internal,/data-club-deal|Free Entry|profile-tonight-deal/);
  for(const label of ['Follow','Share','Working now','I’m Going']) assert.ok(external.includes(label)&&internal.includes(label));
});
