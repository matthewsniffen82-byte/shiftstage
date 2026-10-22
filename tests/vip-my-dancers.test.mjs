import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip, dashboardHarness, guest, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import { isVipFollowing, vipDestination } from '../src/lib/dancr/vip-dashboard.ts';
import { plannerHarness } from './helpers/vip-planner-fixture.mjs';

class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const service = compileVip('src/lib/dancr/vip.ts', {
  '../api-error-policy': { PublicApiError }, './media-delivery-url': { dancerPhotoDeliveryUrl: path => `/photo/${path}` },
});
const cards = [
  { id: 'aria', stage_name: 'Aria', working_now: true, following: true, previouslyRequested: true, canRequest: true, profileHref: '/dancers/aria' },
  { id: 'nova', stage_name: 'Nova', working_now: false, following: false, previouslyRequested: false, canRequest: true, profileHref: '/dancers/nova' },
  { id: 'past', stage_name: 'Past dancer', working_now: false, following: true, previouslyRequested: true, canRequest: false, profileHref: null },
];
function database({ failure, denied = false, large = false, roster = cards.filter(d => d.canRequest) } = {}) {
  const calls = [];
  const tables = {
    venue_vip_members: venues.map(v => ({ user_id: guest.id, active: !denied, display_name: v.guestName, venue: { ...v, is_active: true, owner: { role: 'venue', account_state: 'active' } } })),
    favorites: [{ customer_id: guest.id, dancer_id: 'favorite-only' }],
    follows: [{ customer_id: guest.id, dancer_id: 'aria' }, { customer_id: guest.id, dancer_id: 'hidden' }, { customer_id: guest.id, dancer_id: 'nova' }, { customer_id: 'other', dancer_id: 'secret' }],
    venue_vip_requests: [
      { id: 'request-3', user_id: guest.id, venue_id: venues[0].id, dancers: [{ id: 'aria', stageName: 'Old name' }, { id: 'past', stageName: 'Past dancer' }] },
      { id: 'request-2', user_id: 'other', venue_id: venues[0].id, dancers: [{ id: 'secret', stageName: 'Secret dancer' }] },
      { id: 'request-1', user_id: guest.id, venue_id: venues[1].id, dancers: [{ id: 'other-venue', stageName: 'Other venue dancer' }] },
    ],
    dancer_profiles: [
      { id: 'aria', slug: 'aria', stage_name: 'Aria', status: 'approved', verification_status: 'approved', is_incognito: false, is_public: true, disabled_at: null, avatar_storage_path: 'aria/photo.jpg' },
      { id: 'nova', slug: 'nova', stage_name: 'Nova', status: 'approved', verification_status: 'approved', is_incognito: false, is_public: true, disabled_at: null, avatar_storage_path: 'https://private.test/photo' },
      { id: 'hidden', slug: 'secret-profile', stage_name: 'Private stage name', status: 'approved', verification_status: 'approved', is_incognito: true, is_public: false, disabled_at: null, avatar_storage_path: 'private/photo.jpg' },
    ],
  };
  if (large) {
    tables.follows.push(...Array.from({ length: 501 }, (_, i) => ({ customer_id: guest.id, dancer_id: `saved-${String(i).padStart(3, '0')}` })));
    tables.venue_vip_requests.unshift(...Array.from({ length: 501 }, (_, i) => ({ id: `z-${i}`, user_id: guest.id, venue_id: venues[0].id, dancers: [] })));
  }
  return { calls, tables, client: {
    from(table) {
      let rows = [...tables[table]], range, limit;
      const steps = []; calls.push({ table, steps });
      const query = {
        select(columns) { steps.push(['select', columns]); return query; },
        eq(key, value) { steps.push(['eq', key, value]); rows = rows.filter(row => row[key] === value); return query; },
        is(key, value) { steps.push(['is', key, value]); rows = rows.filter(row => row[key] === value); return query; },
        in(key, values) { steps.push(['in', key, values]); rows = rows.filter(row => values.includes(row[key])); return query; },
        gt(key, value) { steps.push(['gt', key, value]); rows = rows.filter(row => row[key] > value); return query; },
        order(key, options) { rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options?.ascending === false ? -1 : 1)); return query; },
        range(start, end) { range = [start, end]; steps.push(['range', start, end]); return query; },
        limit(value) { limit = value; return query; },
        then(resolve, reject) { return Promise.resolve({ data: range ? rows.slice(range[0], range[1] + 1) : limit ? rows.slice(0, limit) : rows, count: rows.length, error: failure === table ? new Error('read failed') : null }).then(resolve, reject); },
      };
      return query;
    },
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: roster.map(d => ({ id: d.id, stage_name: d.stage_name, working_now: d.working_now })), error: failure === 'roster' ? new Error('read failed') : null }; },
  } };
}

test('My dancers joins the club roster, guest collections, and selected venue history, retaining eligible off-shift dancers without resurrecting hidden history', async () => {
  const db = database();
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers' }));
  const byId = new Map(result.dancers.map(d => [d.id, d]));
  assert.deepEqual([...byId.keys()].sort(), ['aria', 'nova']);
  assert.equal(byId.get('aria').following, true); assert.ok(result.dancers.every(d => !("favorite" in d)));
  assert.ok(!db.calls.some(c => c.table === 'favorites'));
  assert.equal(byId.get('aria').workingAlertsEnabled, true);
  assert.equal(byId.get('nova').workingAlertsEnabled, true, 'cached clients see Follow as their alert preference');
  assert.equal(byId.get('aria').previouslyRequested, true); assert.equal(byId.get('aria').stage_name, 'Aria');
  assert.equal(byId.get('aria').canRequest, true); assert.equal(byId.get('aria').photoUrl, '/photo/aria/photo.jpg');
  assert.equal(byId.get('nova').following, true); assert.equal(byId.get('nova').photoUrl, null);
  assert.equal(result.requests.length, 0);
  for (const call of db.calls.filter(c => c.table === 'follows')) assert.ok(call.steps.some(s => s[0] === 'eq' && s[1] === 'customer_id' && s[2] === guest.id));
  const other = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers', venueId: venues[1].id }));
  assert.equal(other.dancers.find(d => d.id === 'aria').previouslyRequested, false);
  assert.equal(other.dancers.find(d => d.id === 'aria').workingAlertsEnabled, true);
  assert.equal(other.dancers.find(d => d.id === 'nova').following, true, 'the same Follow is shared across clubs');
  assert.ok(!db.calls.some(c => c.table === 'venue_vip_working_alerts'));
  assert.ok(!other.dancers.some(d => d.id === 'other-venue'));
  assert.ok(!other.dancers.some(d => d.id === 'past'));
});

test('club dancers include unfollowed off-shift affiliates without resurrecting unavailable historical profiles', async () => {
  const db = database({ roster: [...cards.filter(d => d.canRequest), { id: 'affiliate', stage_name: 'Off-shift affiliate', working_now: false }] });
  db.tables.dancer_profiles.push({ ...db.tables.dancer_profiles[0], id: 'affiliate', stage_name: 'Off-shift affiliate' });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers', venueId: venues[0].id }));
  const affiliated = result.dancers.find(d => d.id === 'affiliate');
  assert.equal(affiliated.canRequest, false); assert.equal(affiliated.working_now, false);
  assert.equal(affiliated.following, false); assert.equal(affiliated.previouslyRequested, false);
  assert.ok(!result.dancers.some(d => d.id === 'past'));
  assert.ok(!result.dancers.some(d => d.id === 'other-venue'));
  assert.equal(db.calls.find(c => c.rpc).args.p_venue, venues[0].id);
});

test('overview follows use only the guest follows and the selected venue current roster', async () => {
  const db = database({ roster: [...cards.filter(d => d.canRequest), { id: 'secret', stage_name: 'Other guest follow', working_now: true }] });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview', venueId: venues[1].id }));
  assert.deepEqual(Array.from(result.dancers, d => d.id), ['aria']);
  assert.equal(result.dancers[0].canRequest, true);
  assert.equal(result.dancers[0].photoUrl, '/photo/aria/photo.jpg');
  assert.equal(result.dancers[0].profileHref, '/dancers/aria');
  assert.equal(db.calls.find(c => c.rpc).args.p_venue, venues[1].id);
  assert.ok(db.calls.filter(c => ['follows'].includes(c.table)).every(c => c.steps.some(s => s[0] === 'eq' && s[1] === 'customer_id' && s[2] === guest.id)));
  assert.ok(!db.calls.some(c => c.steps?.some(s => s[0] === 'select' && s[1] === 'id,dancers')));
  db.tables.follows.push({ customer_id: guest.id, dancer_id: 'nova' });
  assert.deepEqual(Array.from((await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }))).dancers, d => d.id), ['aria'], 'off-shift follows are omitted');
  db.tables.dancer_profiles[0].is_incognito = true;
  const hidden = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.equal(hidden.dancers.length, 0);
});

test('overview follows remain bounded, paginate follows, and skip roster reads for an empty collection', async () => {
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `saved-${500 - i}`, stage_name: `Dancer ${i}`, working_now: true }));
  const db = database({ large: true, roster });
  db.tables.dancer_profiles.push(...roster.map(d => ({...db.tables.dancer_profiles[0], id:d.id, stage_name:d.stage_name})));
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.deepEqual(Array.from(result.dancers, d => d.id), ['saved-500', 'saved-499', 'saved-498', 'saved-497']);
  assert.ok(db.calls.some(c => c.table === 'follows' && c.steps.some(s => s[0] === 'range' && s[1] === 500)));
  assert.equal(db.calls.find(c => c.table === 'dancer_profiles').steps.find(s => s[0] === 'in')[2].length, 4);
  const empty = database(); empty.tables.follows = [];
  assert.equal((await service.getVipState(empty.client, guest.id, new URLSearchParams({ view: 'overview' }))).dancers.length, 0);
  assert.ok(!empty.calls.some(c => c.rpc || c.table === 'dancer_profiles'));
});

test('overview follows respect revoked access and surface failed reads', async () => {
  const denied = database({ denied: true });
  await assert.rejects(service.getVipState(denied.client, guest.id, new URLSearchParams({ view: 'overview', venueId: venues[0].id })), e => e.status === 403);
  assert.ok(denied.calls.every(c => c.table === 'venue_vip_members'));
  for (const failure of ['follows', 'roster', 'dancer_profiles']) {
    await assert.rejects(service.getVipState(database({ failure }).client, guest.id, new URLSearchParams({ view: 'overview' })), /read failed/);
  }
});

test('overview follows public Follow state and never reads legacy favorites', async () => {
  const db = database({ roster: [...cards.filter(d => d.canRequest).map(d => ({ ...d, working_now: true })),
    { id: 'favorite-only', stage_name: 'Legacy favorite', working_now: true },
    { id: 'secret', stage_name: 'Another guests dancer', working_now: true }] });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.deepEqual(Array.from(result.dancers, d => d.id), ['aria', 'nova']);
  assert.ok(result.dancers.every(d => d.following && !('favorite' in d)));
  assert.ok(!db.calls.some(c => c.table === 'favorites'));
  db.tables.follows = [];
  const unfollowed = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.equal(unfollowed.dancers.length, 0);
});

test('overview followed dancer requests preserve draft details and cannot act on stale accounts or refreshing data', async () => {
  let resolveRefresh, refresh = false;
  const ui = dashboardHarness({ request: async () => refresh ? new Promise(resolve => { resolveRefresh = resolve; }) : state(venues[0].id, { dancers: cards }) });
  await ui.settle(); ui.navigate('plan'); await ui.settle();
  ui.planner().props.onChange({ selected: ['nova'], date: '2027-02-15', time: '21:30' }); ui.render();
  ui.navigate('overview'); await ui.settle();
  ui.workingFollowing().props.onRequest(cards[0]); await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), ['aria']);
  assert.equal(ui.planner().props.draft.date, '2027-02-15'); assert.equal(ui.planner().props.draft.time, '21:30');
  assert.ok(!ui.calls.some(c => c.options.method === 'POST'));
  ui.navigate('overview'); await ui.settle(); refresh = true; ui.advance(16000); ui.event('focus');
  assert.equal(ui.workingFollowing().props.busy, true);
  ui.workingFollowing().props.onRequest(cards[0]); assert.ok(ui.workingFollowing());
  resolveRefresh(state(venues[0].id, { dancers: cards })); await ui.settle();
  ui.session({ id: 'other' }); ui.workingFollowing().props.onRequest(cards[0]); assert.ok(ui.workingFollowing()); ui.unmount();
});

test('working follows expose requests, disabled refresh state, and a useful empty state', () => {
  const { VipWorkingFollowing } = compileVip('app/vip/VipMyDancers.tsx', { '@/src/lib/dancr/vip-dashboard': { isVipFollowing } });
  const requested = [];
  const props = { dancers: cards, onRequest: dancer => requested.push(dancer.id), onBrowse() {}, busy: false };
  const tree = VipWorkingFollowing(props);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Aria/); assert.doesNotMatch(html, /Nova|Past dancer/);
  tree.props.children[1].props.children[0].props.children[2].props.onClick(); assert.deepEqual(requested, ['aria']);
  assert.match(renderToStaticMarkup(React.createElement(VipWorkingFollowing, { ...props, busy: true })), /disabled="" aria-label="Request Aria"/);
  assert.match(renderToStaticMarkup(React.createElement(VipWorkingFollowing, { ...props, dancers: [] })), /No dancers you follow are working at this venue/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(VipWorkingFollowing, { ...props, dancers: [{ ...cards[1], working_now: true }] })), /Request Nova/);
});

test('collections and old request history paginate fully and profile lookups stay bounded', async () => {
  const db = database({ large: true });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers' }));
  assert.equal(result.dancers.filter(d => d.following).length, 2);
  assert.ok(!result.dancers.some(d => d.id === 'saved-500'));
  assert.ok(!result.dancers.some(d => d.id === 'past'));
  for (const table of ['follows', 'venue_vip_requests']) assert.ok(db.calls.some(c => c.table === table && c.steps.some(s => s[0] === 'range' && s[1] === 500)));
  assert.ok(db.calls.filter(c => c.table === 'dancer_profiles').every(c => c.steps.find(s => s[0] === 'in')[2].length <= 200));
});

test('the My dancers API uses the authenticated customer and sends private no-store headers', async () => {
  const db = database();
  const route = compileVip('app/api/vip/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/api': { apiError: error => Response.json({ error: error.message }, { status: error.status || 500 }), PublicApiError },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async (_request, options) => {
      assert.equal(options.role, 'customer'); return { user: { id: guest.id }, session: { accessToken: 'rotated' } };
    } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => db.client },
    '@/src/lib/dancr/vip': service,
  }, { URL });
  const response = await route.GET(new Request('https://example.test/api/vip?view=dancers&userId=other'));
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private.*no-store/);
  const result = await response.json(); assert.equal(result.session.accessToken, 'rotated');
  assert.ok(!result.dancers.some(d => d.id === 'secret'));
});

test('revoked or wrong-venue access cannot read private collections, and source failures do not look like empty lists', async () => {
  const db = database({ denied: true });
  assert.equal((await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers' }))).dancers.length, 0);
  await assert.rejects(service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers', venueId: venues[0].id })), error => error.status === 403);
  assert.ok(db.calls.every(c => c.table === 'venue_vip_members'));
  for (const failure of ['follows', 'venue_vip_requests', 'dancer_profiles', 'roster']) {
    await assert.rejects(service.getVipState(database({ failure }).client, guest.id, new URLSearchParams({ view: 'dancers' })), /read failed/);
  }
});

test('My dancers combines both legacy destinations and preserves the current venue draft without submitting', async () => {
  assert.equal(vipDestination('#vip-dancers'), 'plan');
  assert.equal(vipDestination('#vip-plan'), 'plan');
  const ui = dashboardHarness({ hash: '#vip-dancers', request: async url => state(new URL(url, 'https://example.test').searchParams.get('venueId') || venues[0].id, { dancers: cards }) });
  await ui.settle(); assert.ok(ui.planner()); assert.match(ui.calls.at(-1).url, /view=dancers/);
  const nav=ui.nodes().find(node=>node.type==='nav'&&node.props['aria-label']==='VIP dashboard');
  assert.deepEqual(ui.nodes(nav).filter(node=>node.type==='button').map(node=>ui.nodes(node).find(child=>child.type==='span').props.children),['Overview','My dancers','Requests','Account']);
  ui.planner().props.onChange({ selected: ['nova','aria'], date: '2027-02-15', time: '21:30' }); ui.render();
  ui.navigate('requests'); await ui.settle();ui.navigate('plan');await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), ['aria']);
  assert.equal(ui.planner().props.draft.date, '2027-02-15'); assert.equal(ui.planner().props.draft.time, '21:30');
  assert.ok(!ui.calls.some(c => c.options.method === 'POST'));
  ui.hash('#vip-dancers');await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), ['aria']);
  ui.nodes().find(n => n.type === 'select').props.onChange({ target: { value: venues[1].id } }); await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), []);
  assert.equal(ui.planner().props.draft.date, ''); ui.unmount();
});

test('full drafts and changed accounts cannot add dancers, while follow controls update inside My dancers', async () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ ...cards[0], id: `dancer-${i}` }));
  const ui = dashboardHarness({ hash: '#vip-plan', request: async (url, options) => options.method === 'POST' ? { following: false } : state(venues[0].id, { dancers: many }) });
  await ui.settle(); ui.planner().props.onChange({ selected: many.slice(0, 10).map(d => d.id), date: '', time: '' }); ui.render();
  ui.planner().props.onChange({ ...ui.planner().props.draft, selected: many.map(d=>d.id) }); ui.render();
  assert.equal(ui.planner().props.draft.selected.length,10);
  await ui.planner().props.onFollow(many[0]); await ui.settle(); assert.equal(ui.planner().props.dancers[0].following, false);
  ui.session({ id: 'other' }); ui.planner().props.onChange({ selected: [],date:'',time:'' });ui.render();
  assert.equal(ui.planner().props.draft.selected.length,10); ui.unmount();
});

test('reloading a draft drops dancers who remain in the library but are unavailable at this club', async () => {
  let available=true;
  const ui=dashboardHarness({hash:'#vip-plan',request:async()=>state(venues[0].id,{dancers:cards.map(dancer=>dancer.id==='aria'?{...dancer,canRequest:available}:dancer)})});
  await ui.settle();ui.planner().props.onChange({selected:['aria','nova'],date:'2027-02-15',time:'21:30'});ui.render();
  available=false;ui.navigate('overview');await ui.settle();ui.navigate('plan');await ui.settle();
  assert.equal(ui.planner().props.dancers.some(dancer=>dancer.id==='aria'),true);
  assert.deepEqual(Array.from(ui.planner().props.draft.selected),[]);
  assert.equal(ui.planner().props.draft.date,'2027-02-15');ui.unmount();
});

test('combined dancer filters only show working dancers while retaining follow and request history actions', () => {
  const saves=[];
  const ui=plannerHarness({dancers:cards,onFollow:async dancer=>saves.push(dancer.id),onRequests(){}});
  const html=()=>renderToStaticMarkup(ui.tree());
  assert.match(html(),/Aria/);assert.doesNotMatch(html(),/Nova|Past dancer/);
  ui.filter('Following');assert.doesNotMatch(html(),/Nova/);assert.equal(ui.nodes().filter(node=>node.type==='article').length,1);
  ui.filter('Working now');
  const followControl=ui.nodes().find(node=>node.props?.['aria-label']==='Unfollow Aria');
  assert.equal(followControl.props['aria-pressed'],true);assert.equal(followControl.props.disabled,false);
  const profile=ui.nodes().find(node=>node.type==='a');
  assert.equal(profile.props.href,'/?profile=aria');
  assert.equal(ui.nodes().some(node=>node.type==='article' && node.key==='past'),false);
  ui.nodes().find(node=>node.props?.className==='vip-dancer-follow').props.onClick();assert.deepEqual(saves,['aria']);
  ui.nodes().find(node=>node.props?.type==='checkbox').props.onChange({target:{checked:true}});ui.render();
  assert.doesNotMatch(html(),/Past dancer/);
  ui.search('missing');assert.match(html(),/No working dancers match/);
  ui.button('Show working dancers').props.onClick();ui.render();assert.match(html(),/Aria/);
  ui.filter('Requested before');assert.match(html(),/View request status/);assert.doesNotMatch(html(),/Nova/);
  ui.props.dancers=[];ui.render();assert.match(html(),/No dancers are working now at this club/);
});

test('choosing dancers and moving between steps keeps filters and visit details without sending early', async () => {
  let sent=0;
  const ui=plannerHarness({dancers:cards,onSubmit:async()=>sent++});
  ui.filter('Following');ui.search('aria');ui.select('aria');
  assert.deepEqual(Array.from(ui.props.draft.selected),['aria']);
  assert.equal(ui.nodes().find(node=>node.props?.id==='vip-visit-details').props.hidden,true);
  ui.details();assert.equal(ui.nodes().find(node=>node.props?.id==='vip-choose-dancers').props.hidden,true);
  assert.equal(ui.focused.at(-1),'vip-visit-details');
  ui.nodes().find(node=>node.props?.type==='date').props.onChange({target:{value:'2027-02-15'}});ui.render();
  ui.nodes().find(node=>node.props?.type==='time').props.onChange({target:{value:'21:30'}});ui.render();
  ui.back();assert.equal(ui.focused.at(-1),'vip-choose-dancers');
  assert.equal(ui.button('Following').props['aria-pressed'],true);
  assert.equal(ui.nodes().find(node=>node.props?.type==='search').props.value,'aria');
  assert.equal(ui.props.draft.date,'2027-02-15');assert.equal(ui.props.draft.time,'21:30');
  ui.select('aria',false);assert.equal(ui.nodes().some(node=>node.props?.className==='vip-mobile-continue'),false);
  ui.select('aria');ui.details();assert.equal(sent,0);
  ui.nodes().find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await Promise.resolve();assert.equal(sent,1);
});


test('Internal-only VIP cards use authenticated media and retain profiles; Incognito excludes even stale roster rows', async()=>{
 const db=database();db.tables.dancer_profiles[0].is_public=false;
 const result=await service.getVipState(db.client,guest.id,new URLSearchParams({view:'dancers'}));
 const dancer=result.dancers.find(d=>d.id==='aria');
 assert.equal(dancer.profileHref,'/dancers/aria');assert.equal(dancer.canRequest,true);
 assert.equal(dancer.photoUrl,`/api/internal/avatar/aria?width=320&vipVenueId=${venues[0].id}`);
 db.tables.dancer_profiles[0].is_incognito=true;
 for(const view of ['dancers','overview','plan']) {
  const hidden=await service.getVipState(db.client,guest.id,new URLSearchParams({view}));
  assert.ok(!hidden.dancers.some(d=>d.id==='aria'));
 }
});
