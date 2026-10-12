import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip, dashboardHarness, guest, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import { isVipFavorite, vipDestination } from '../src/lib/dancr/vip-dashboard.ts';
import { plannerHarness } from './helpers/vip-planner-fixture.mjs';

class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const service = compileVip('src/lib/dancr/vip.ts', {
  '../api-error-policy': { PublicApiError }, './media-delivery-url': { dancerPhotoDeliveryUrl: path => `/photo/${path}` },
});
const cards = [
  { id: 'aria', stage_name: 'Aria', working_now: true, favorite: true, following: false, previouslyRequested: true, canRequest: true, profileHref: '/dancers/aria' },
  { id: 'nova', stage_name: 'Nova', working_now: false, favorite: false, following: true, previouslyRequested: false, canRequest: true, profileHref: '/dancers/nova' },
  { id: 'past', stage_name: 'Past dancer', working_now: false, favorite: true, following: true, previouslyRequested: true, canRequest: false, profileHref: null },
];
function database({ failure, denied = false, large = false, roster = cards.filter(d => d.canRequest) } = {}) {
  const calls = [];
  const tables = {
    venue_vip_members: venues.map(v => ({ user_id: guest.id, active: !denied, display_name: v.guestName, venue: { ...v, is_active: true, owner: { role: 'venue', account_state: 'active' } } })),
    favorites: [{ customer_id: guest.id, dancer_id: 'aria' }, { customer_id: guest.id, dancer_id: 'hidden' }, { customer_id: 'other', dancer_id: 'secret' }],
    follows: [{ customer_id: guest.id, dancer_id: 'nova' }, { customer_id: 'other', dancer_id: 'secret' }],
    venue_vip_requests: [
      { id: 'request-3', user_id: guest.id, venue_id: venues[0].id, dancers: [{ id: 'aria', stageName: 'Old name' }, { id: 'past', stageName: 'Past dancer' }] },
      { id: 'request-2', user_id: 'other', venue_id: venues[0].id, dancers: [{ id: 'secret', stageName: 'Secret dancer' }] },
      { id: 'request-1', user_id: guest.id, venue_id: venues[1].id, dancers: [{ id: 'other-venue', stageName: 'Other venue dancer' }] },
    ],
    dancer_profiles: [
      { id: 'aria', slug: 'aria', stage_name: 'Aria', status: 'approved', verification_status: 'approved', is_public: true, disabled_at: null, avatar_storage_path: 'aria/photo.jpg' },
      { id: 'nova', slug: 'nova', stage_name: 'Nova', status: 'approved', verification_status: 'approved', is_public: true, disabled_at: null, avatar_storage_path: 'https://private.test/photo' },
      { id: 'hidden', slug: 'secret-profile', stage_name: 'Private stage name', status: 'approved', verification_status: 'approved', is_public: false, disabled_at: null, avatar_storage_path: 'private/photo.jpg' },
    ],
  };
  if (large) {
    tables.favorites.push(...Array.from({ length: 501 }, (_, i) => ({ customer_id: guest.id, dancer_id: `saved-${String(i).padStart(3, '0')}` })));
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

test('My dancers joins the club roster, guest collections, and selected venue history, retaining off-shift and unavailable dancers', async () => {
  const db = database();
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers' }));
  const byId = new Map(result.dancers.map(d => [d.id, d]));
  assert.deepEqual([...byId.keys()].sort(), ['aria', 'hidden', 'nova', 'past']);
  assert.equal(byId.get('aria').favorite, true); assert.equal(byId.get('aria').following, false);
  assert.equal(byId.get('aria').workingAlertsEnabled, false);
  assert.equal(byId.get('nova').workingAlertsEnabled, true, 'cached clients see Follow as their alert preference');
  assert.equal(byId.get('aria').previouslyRequested, true); assert.equal(byId.get('aria').stage_name, 'Aria');
  assert.equal(byId.get('aria').canRequest, true); assert.equal(byId.get('aria').photoUrl, '/photo/aria/photo.jpg');
  assert.equal(byId.get('nova').following, true); assert.equal(byId.get('nova').favorite, false); assert.equal(byId.get('nova').photoUrl, null);
  assert.equal(byId.get('hidden').stage_name, 'Unavailable dancer'); assert.equal(byId.get('hidden').profileHref, null); assert.equal(byId.get('hidden').photoUrl, null);
  assert.equal(byId.get('past').previouslyRequested, true); assert.equal(byId.get('past').canRequest, false);
  assert.equal(result.requests.length, 0);
  for (const call of db.calls.filter(c => ['favorites', 'follows'].includes(c.table))) assert.ok(call.steps.some(s => s[0] === 'eq' && s[1] === 'customer_id' && s[2] === guest.id));
  const other = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers', venueId: venues[1].id }));
  assert.equal(other.dancers.find(d => d.id === 'aria').previouslyRequested, false);
  assert.equal(other.dancers.find(d => d.id === 'aria').workingAlertsEnabled, false);
  assert.equal(other.dancers.find(d => d.id === 'nova').following, true, 'the same Follow is shared across clubs');
  assert.ok(!db.calls.some(c => c.table === 'venue_vip_working_alerts'));
  assert.ok(other.dancers.some(d => d.id === 'other-venue' && d.previouslyRequested));
  assert.ok(!other.dancers.some(d => d.id === 'past'));
});

test('club dancers include unaffavorited off-shift affiliates and past requests but not another club history', async () => {
  const db = database({ roster: [...cards.filter(d => d.canRequest), { id: 'affiliate', stage_name: 'Off-shift affiliate', working_now: false }] });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers', venueId: venues[0].id }));
  const affiliated = result.dancers.find(d => d.id === 'affiliate');
  assert.equal(affiliated.canRequest, true); assert.equal(affiliated.working_now, false);
  assert.equal(affiliated.favorite, false); assert.equal(affiliated.following, false); assert.equal(affiliated.previouslyRequested, false);
  assert.ok(result.dancers.some(d => d.id === 'past' && !d.canRequest && d.previouslyRequested));
  assert.ok(!result.dancers.some(d => d.id === 'other-venue'));
  assert.equal(db.calls.find(c => c.rpc).args.p_venue, venues[0].id);
});

test('overview favorites use only the guest favorites and the selected venue current roster', async () => {
  const db = database({ roster: [...cards.filter(d => d.canRequest), { id: 'secret', stage_name: 'Other guest favorite', working_now: true }] });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview', venueId: venues[1].id }));
  assert.deepEqual(Array.from(result.dancers, d => d.id), ['aria']);
  assert.equal(result.dancers[0].canRequest, true);
  assert.equal(result.dancers[0].photoUrl, '/photo/aria/photo.jpg');
  assert.equal(result.dancers[0].profileHref, '/dancers/aria');
  assert.equal(db.calls.find(c => c.rpc).args.p_venue, venues[1].id);
  assert.ok(db.calls.filter(c => ['favorites', 'follows'].includes(c.table)).every(c => c.steps.some(s => s[0] === 'eq' && s[1] === 'customer_id' && s[2] === guest.id)));
  assert.ok(!db.calls.some(c => c.steps?.some(s => s[0] === 'select' && s[1] === 'id,dancers')));
  db.tables.favorites.push({ customer_id: guest.id, dancer_id: 'nova' });
  assert.deepEqual(Array.from((await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }))).dancers, d => d.id), ['aria'], 'off-shift favorites are omitted');
  db.tables.dancer_profiles[0].is_public = false;
  const hidden = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.equal(hidden.dancers[0].profileHref, null); assert.equal(hidden.dancers[0].photoUrl, null);
});

test('overview favorites remain bounded, paginate favorites, and skip roster reads for an empty collection', async () => {
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `saved-${500 - i}`, stage_name: `Dancer ${i}`, working_now: true }));
  const db = database({ large: true, roster });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.deepEqual(Array.from(result.dancers, d => d.id), ['saved-500', 'saved-499', 'saved-498', 'saved-497']);
  assert.ok(db.calls.some(c => c.table === 'favorites' && c.steps.some(s => s[0] === 'range' && s[1] === 500)));
  assert.equal(db.calls.find(c => c.table === 'dancer_profiles').steps.find(s => s[0] === 'in')[2].length, 4);
  const empty = database(); empty.tables.favorites = []; empty.tables.follows = [];
  assert.equal((await service.getVipState(empty.client, guest.id, new URLSearchParams({ view: 'overview' }))).dancers.length, 0);
  assert.ok(!empty.calls.some(c => c.rpc || c.table === 'dancer_profiles'));
});

test('overview favorites respect revoked access and surface failed reads', async () => {
  const denied = database({ denied: true });
  await assert.rejects(service.getVipState(denied.client, guest.id, new URLSearchParams({ view: 'overview', venueId: venues[0].id })), e => e.status === 403);
  assert.ok(denied.calls.every(c => c.table === 'venue_vip_members'));
  for (const failure of ['favorites', 'follows', 'roster', 'dancer_profiles']) {
    await assert.rejects(service.getVipState(database({ failure }).client, guest.id, new URLSearchParams({ view: 'overview' })), /read failed/);
  }
});

test('overview only shows favorites without turning public follows into favorites', async () => {
  const db = database({ roster: [...cards.filter(d => d.canRequest).map(d => ({ ...d, working_now: true })),
    { id: 'secret', stage_name: 'Another guests dancer', working_now: true }] });
  db.tables.follows.push({ customer_id: guest.id, dancer_id: 'aria' });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.deepEqual(Array.from(result.dancers, d => d.id), ['aria']);
  assert.equal(result.dancers[0].favorite, true); assert.equal(result.dancers[0].following, true);
  db.tables.favorites = [];
  const followedOnly = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.deepEqual(Array.from(followedOnly.dancers, d => d.id), []);
});

test('overview favorite requests preserve draft details and cannot act on stale accounts or refreshing data', async () => {
  let resolveRefresh, refresh = false;
  const ui = dashboardHarness({ request: async () => refresh ? new Promise(resolve => { resolveRefresh = resolve; }) : state(venues[0].id, { dancers: cards }) });
  await ui.settle(); ui.navigate('plan'); await ui.settle();
  ui.planner().props.onChange({ selected: ['nova'], date: '2027-02-15', time: '21:30' }); ui.render();
  ui.navigate('overview'); await ui.settle();
  ui.workingFavorites().props.onRequest(cards[0]); await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), ['nova', 'aria']);
  assert.equal(ui.planner().props.draft.date, '2027-02-15'); assert.equal(ui.planner().props.draft.time, '21:30');
  assert.ok(!ui.calls.some(c => c.options.method === 'POST'));
  ui.navigate('overview'); await ui.settle(); refresh = true; ui.advance(16000); ui.event('focus');
  assert.equal(ui.workingFavorites().props.busy, true);
  ui.workingFavorites().props.onRequest(cards[0]); assert.ok(ui.workingFavorites());
  resolveRefresh(state(venues[0].id, { dancers: cards })); await ui.settle();
  ui.session({ id: 'other' }); ui.workingFavorites().props.onRequest(cards[0]); assert.ok(ui.workingFavorites()); ui.unmount();
});

test('working favorites expose requests, disabled refresh state, and a useful empty state', () => {
  const { VipWorkingFavorites } = compileVip('app/vip/VipMyDancers.tsx', { '@/src/lib/dancr/vip-dashboard': { isVipFavorite } });
  const requested = [];
  const props = { dancers: cards, onRequest: dancer => requested.push(dancer.id), onBrowse() {}, busy: false };
  const tree = VipWorkingFavorites(props);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Aria/); assert.doesNotMatch(html, /Nova|Past dancer/);
  tree.props.children[1].props.children[0].props.children[2].props.onClick(); assert.deepEqual(requested, ['aria']);
  assert.match(renderToStaticMarkup(React.createElement(VipWorkingFavorites, { ...props, busy: true })), /disabled="" aria-label="Request Aria"/);
  assert.match(renderToStaticMarkup(React.createElement(VipWorkingFavorites, { ...props, dancers: [] })), /None of your favorites are working at this venue/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(VipWorkingFavorites, { ...props, dancers: [{ ...cards[1], working_now: true }] })), /Request Nova/);
});

test('collections and old request history paginate fully and profile lookups stay bounded', async () => {
  const db = database({ large: true });
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'dancers' }));
  assert.equal(result.dancers.filter(d => d.favorite).length, 503);
  assert.ok(result.dancers.some(d => d.id === 'saved-500'));
  assert.ok(result.dancers.some(d => d.id === 'past' && d.previouslyRequested));
  for (const table of ['favorites', 'venue_vip_requests']) assert.ok(db.calls.some(c => c.table === table && c.steps.some(s => s[0] === 'range' && s[1] === 500)));
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
  for (const failure of ['favorites', 'follows', 'venue_vip_requests', 'dancer_profiles', 'roster']) {
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
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), ['nova', 'aria']);
  assert.equal(ui.planner().props.draft.date, '2027-02-15'); assert.equal(ui.planner().props.draft.time, '21:30');
  assert.ok(!ui.calls.some(c => c.options.method === 'POST'));
  ui.hash('#vip-dancers');await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), ['nova', 'aria']);
  ui.nodes().find(n => n.type === 'select').props.onChange({ target: { value: venues[1].id } }); await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), []);
  assert.equal(ui.planner().props.draft.date, ''); ui.unmount();
});

test('full drafts and changed accounts cannot add dancers, while saved hearts update inside My dancers', async () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ ...cards[0], id: `dancer-${i}` }));
  const ui = dashboardHarness({ hash: '#vip-plan', request: async (url, options) => options.method === 'POST' ? { favorite: false } : state(venues[0].id, { dancers: many }) });
  await ui.settle(); ui.planner().props.onChange({ selected: many.slice(0, 10).map(d => d.id), date: '', time: '' }); ui.render();
  ui.planner().props.onChange({ ...ui.planner().props.draft, selected: many.map(d=>d.id) }); ui.render();
  assert.equal(ui.planner().props.draft.selected.length,10);
  await ui.planner().props.onFavorite(many[0]); await ui.settle(); assert.equal(ui.planner().props.dancers[0].favorite, false);
  ui.session({ id: 'other' }); ui.planner().props.onChange({ selected: [],date:'',time:'' });ui.render();
  assert.equal(ui.planner().props.draft.selected.length,10); ui.unmount();
});

test('reloading a draft drops dancers who remain in the library but are unavailable at this club', async () => {
  let available=true;
  const ui=dashboardHarness({hash:'#vip-plan',request:async()=>state(venues[0].id,{dancers:cards.map(dancer=>dancer.id==='aria'?{...dancer,canRequest:available}:dancer)})});
  await ui.settle();ui.planner().props.onChange({selected:['aria','nova'],date:'2027-02-15',time:'21:30'});ui.render();
  available=false;ui.navigate('overview');await ui.settle();ui.navigate('plan');await ui.settle();
  assert.equal(ui.planner().props.dancers.some(dancer=>dancer.id==='aria'),true);
  assert.deepEqual(Array.from(ui.planner().props.draft.selected),['nova']);
  assert.equal(ui.planner().props.draft.date,'2027-02-15');ui.unmount();
});

test('combined dancer filters preserve favorites, follows, request history and unavailable profiles', () => {
  const saves=[];
  const ui=plannerHarness({dancers:cards,onFavorite:async dancer=>saves.push(dancer.id),onRequests(){}});
  const html=()=>renderToStaticMarkup(ui.tree());
  assert.match(html(),/Aria/);assert.match(html(),/Nova/);assert.match(html(),/Previously requested · unavailable/);
  ui.filter('Favorites');assert.doesNotMatch(html(),/Nova/);assert.equal(ui.nodes().filter(node=>node.type==='article').length,2);
  ui.filter('Following');assert.doesNotMatch(html(),/Open Aria profile/);assert.equal(ui.nodes().filter(node=>node.type==='article').length,2);
  ui.filter('This club');
  const followedHeart=ui.nodes().find(node=>node.props?.['aria-label']==='Save Nova to favorites');
  assert.equal(followedHeart.props['aria-pressed'],false);assert.equal(followedHeart.props.disabled,false);
  const profile=ui.nodes().find(node=>node.type==='a');
  assert.equal(new URL(profile.props.href,'https://example.test').searchParams.get('return_to'),`/vip?venueId=${venues[0].id}#vip-plan`);
  ui.select('past');assert.equal(ui.props.draft.selected.length,0);
  ui.nodes().find(node=>node.props?.className==='vip-dancer-favorite').props.onClick();assert.deepEqual(saves,['aria']);
  ui.nodes().find(node=>node.props?.type==='checkbox').props.onChange({target:{checked:true}});ui.render();
  assert.doesNotMatch(html(),/Past dancer/);
  ui.search('missing');assert.match(html(),/No dancers match/);
  ui.button('Show club dancers').props.onClick();ui.render();assert.match(html(),/Nova/);
  ui.filter('Requested before');assert.match(html(),/View request status/);assert.doesNotMatch(html(),/Nova/);
  ui.props.dancers=[];ui.render();assert.match(html(),/No dancers at this club yet/);
});

test('choosing dancers and moving between steps keeps filters and visit details without sending early', async () => {
  let sent=0;
  const ui=plannerHarness({dancers:cards,onSubmit:async()=>sent++});
  ui.filter('Favorites');ui.search('aria');ui.select('aria');
  assert.deepEqual(Array.from(ui.props.draft.selected),['aria']);
  assert.equal(ui.nodes().find(node=>node.props?.id==='vip-visit-details').props.hidden,true);
  ui.details();assert.equal(ui.nodes().find(node=>node.props?.id==='vip-choose-dancers').props.hidden,true);
  assert.equal(ui.focused.at(-1),'vip-visit-details');
  ui.nodes().find(node=>node.props?.type==='date').props.onChange({target:{value:'2027-02-15'}});ui.render();
  ui.nodes().find(node=>node.props?.type==='time').props.onChange({target:{value:'21:30'}});ui.render();
  ui.back();assert.equal(ui.focused.at(-1),'vip-choose-dancers');
  assert.equal(ui.button('Favorites').props['aria-pressed'],true);
  assert.equal(ui.nodes().find(node=>node.props?.type==='search').props.value,'aria');
  assert.equal(ui.props.draft.date,'2027-02-15');assert.equal(ui.props.draft.time,'21:30');
  ui.select('aria',false);assert.equal(ui.nodes().some(node=>node.props?.className==='vip-mobile-continue'),false);
  ui.select('aria');ui.details();assert.equal(sent,0);
  ui.nodes().find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await Promise.resolve();assert.equal(sent,1);
});
