import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardHarness, compileVip, venues, dancers, state, guest } from './helpers/vip-dashboard-fixture.mjs';
import * as helpers from '../src/lib/dancr/vip-dashboard.ts';
import * as types from '../src/lib/dancr/vip-types.ts';

class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const service = compileVip('src/lib/dancr/vip.ts', { '../api-error-policy': { PublicApiError } });
function database({ failure = null } = {}) {
  const calls = [], now = Date.now();
  const row = (id, status, changes = {}) => ({ id, user_id: guest.id, venue_id: venues[0].id, status, starts_at: new Date(now + 3600000).toISOString(), created_at: new Date(now + Number(id) * 1000).toISOString(), ...changes });
  const rows = [row('1', 'confirmed'), row('2', 'confirmed', { starts_at: new Date(now - 3600000).toISOString() }),
    row('3', 'pending', { user_id: 'other-guest' }), row('4', 'pending', { venue_id: venues[1].id }),
    ...Array.from({ length: 60 }, (_, i) => row(String(i + 10), 'pending'))];
  const client = {
    from(table) {
      const call = { table, steps: [] }; calls.push(call);
      let result = table === 'venue_vip_members' ? venues.map(v => ({ user_id: guest.id, active: true, display_name: v.guestName, venue: { ...v, is_active: true, owner: { role: 'venue', account_state: 'active' } } })) : [...rows];
      let options, range, limit;
      const chain = {
        select(columns, nextOptions = {}) { options = nextOptions; call.steps.push(['select', columns, options]); return chain; },
        eq(key, value) { result = result.filter(row => row[key] === value); call.steps.push(['eq', key, value]); return chain; },
        gt(key, value) { result = result.filter(row => row[key] > value); call.steps.push(['gt', key, value]); return chain; },
        order(key, options = {}) { result.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending === false ? -1 : 1)); call.steps.push(['order', key, options]); return chain; },
        range(start, end) { range = [start, end]; return chain; }, limit(value) { limit = value; return chain; },
        then(resolve, reject) { return Promise.resolve({ error: table === 'venue_vip_requests' ? failure : null, count: result.length,
          data: options?.head ? null : range ? result.slice(range[0], range[1] + 1) : limit ? result.slice(0, limit) : result }).then(resolve, reject); },
      };
      return chain;
    },
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: dancers, error: failure }; },
  };
  return { client, calls };
}
test('VIP overview counts the entire scoped history and promotes only the next future confirmed visit', async () => {
  const db = database();
  const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'overview' }));
  assert.equal(result.summary.pending, 60); assert.equal(result.summary.upcoming, 1); assert.equal(result.summary.nextVisit.id, '1');
  assert.equal(result.requests.length, 0); assert.equal(result.dancers.length, 0); assert.ok(!db.calls.some(c => c.rpc));
  for (const call of db.calls.filter(c => c.table === 'venue_vip_requests')) {
    assert.ok(call.steps.some(s => s[0] === 'eq' && s[1] === 'user_id' && s[2] === guest.id));
    assert.ok(call.steps.some(s => s[0] === 'eq' && s[1] === 'venue_id' && s[2] === venues[0].id));
  }
});
test('VIP requests filter on the server before pagination, with accurate totals and no roster read', async () => {
  const db = database();
  const first = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'requests', status: 'pending' }));
  const second = await service.getVipState(db.client, guest.id, new URLSearchParams({ view: 'requests', status: 'pending', page: '1' }));
  assert.equal(first.requestCount, 60); assert.equal(first.requests.length, 50); assert.equal(first.hasMore, true);
  assert.equal(second.requestCount, 60); assert.equal(second.requests.length, 10); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.requests, ...second.requests].map(r => r.id)).size, 60);
  assert.ok(first.requests.every(r => r.status === 'pending' && r.user_id === guest.id && r.venue_id === venues[0].id));
  assert.ok(!db.calls.some(c => c.rpc));
});
test('planner and account read only the data needed for that section and retain legacy API compatibility', async () => {
  for (const view of ['plan', 'account', '']) {
    const db = database(); const result = await service.getVipState(db.client, guest.id, new URLSearchParams({ view, venueId: venues[1].id }));
    assert.equal(result.selectedVenueId, venues[1].id);
    assert.equal(db.calls.some(c => c.table === 'venue_vip_requests'), view === '');
    assert.equal(db.calls.some(c => c.rpc === 'vip_eligible_dancers'), view !== 'account');
    if (view !== 'account') assert.equal(db.calls.find(c => c.rpc).args.p_venue, venues[1].id);
  }
});
test('invalid filters, inaccessible venues, and data failures cannot appear as successful empty sections', async () => {
  for (const [params, status] of [[{ view: 'unknown' }, 400], [{ status: 'anything' }, 400], [{ view: 'requests', page: '-1' }, 400], [{ view: 'plan', venueId: 'private-other-venue' }, 403]]) {
    const db = database(); await assert.rejects(service.getVipState(db.client, guest.id, new URLSearchParams(params)), e => e.status === status);
    assert.ok(!db.calls.some(c => c.rpc || c.table === 'venue_vip_requests'));
  }
  for (const view of ['overview', 'plan', 'requests']) {
    const db = database({ failure: new Error('database unavailable') });
    await assert.rejects(service.getVipState(db.client, guest.id, new URLSearchParams({ view })), /database unavailable/);
  }
});
test('dancer search combines stage names and current-work filters while preserving off-shift selections', () => {
  assert.deepEqual(helpers.filterVipDancers(dancers, '', 'all', []).map(d => d.id), ['dancer-1', 'dancer-3', 'dancer-2']);
  assert.deepEqual(helpers.filterVipDancers(dancers, '  NOV ', 'selected', ['dancer-2']).map(d => d.id), ['dancer-2']);
  assert.equal(helpers.filterVipDancers(dancers, 'Nova', 'working', []).length, 0);
  const draft = { selected: ['dancer-2', 'removed'], date: '2027-01-15', time: '21:30', notes: 'Window table' };
  assert.deepEqual(helpers.reconcileVipDraft(draft, dancers), { ...draft, selected: ['dancer-2'] });
});
test('VIP sections retain independent venue drafts, support deep links, and reset pagination on status changes', async () => {
  const ui = dashboardHarness({ hash: '#vip-account' }); await ui.settle();
  assert.equal(ui.nodes().find(n => n.props?.id === 'vip-panel-account').props.hidden, false);
  ui.navigate('plan'); await ui.settle();
  const draft = { selected: ['dancer-2'], date: '2027-01-15', time: '21:30', notes: 'Window table' };
  ui.planner().props.onChange(draft); ui.render(); ui.navigate('requests'); await ui.settle();
  ui.nodes().find(n => n.type === 'select' && n.props.value === 'all').props.onChange({ target: { value: 'confirmed' } }); await ui.settle();
  assert.match(ui.calls.at(-1).url, /status=confirmed&page=0/);
  ui.navigate('plan'); await ui.settle(); assert.deepEqual(ui.planner().props.draft, draft);
  const switchVenue = value => ui.nodes().find(n => n.type === 'select' && n.props.value.startsWith('venue-')).props.onChange({ target: { value } });
  switchVenue(venues[1].id); await ui.settle(); assert.equal(ui.planner().props.draft.selected.length, 0);
  switchVenue(venues[0].id); await ui.settle(); assert.deepEqual(ui.planner().props.draft, draft);
  assert.equal(ui.writes.at(-1), '#vip-plan'); ui.unmount();
});
test('failed submissions preserve the draft and retry identity; successful retry opens pending requests and clears it', async () => {
  let attempts = 0;
  const ui = dashboardHarness({ request: async (_url, options) => {
    if (options.method === 'POST' && ++attempts === 1) throw new Error('Response lost. Please try again.'); return state();
  } });
  await ui.settle(); ui.navigate('plan'); await ui.settle();
  const draft = { selected: ['dancer-2'], date: '2027-01-15', time: '21:30', notes: 'Window table' };
  ui.planner().props.onChange(draft); ui.render(); await ui.planner().props.onSubmit(); await ui.settle();
  assert.match(renderToStaticMarkup(ui.tree()), /Response lost/); assert.deepEqual(ui.planner().props.draft, draft);
  await ui.planner().props.onSubmit(); await ui.settle();
  const posts = ui.calls.filter(c => c.options.method === 'POST').map(c => JSON.parse(c.options.body));
  assert.equal(posts.length, 2); assert.equal(posts[0].requestId, posts[1].requestId);
  assert.equal(posts[0].venueId, venues[0].id); assert.deepEqual(posts[0].dancerIds, ['dancer-2']);
  assert.match(ui.calls.at(-1).url, /view=requests.*status=pending/); assert.equal(ui.writes.at(-1), '#vip-requests');
  ui.navigate('plan'); await ui.settle(); assert.equal(ui.planner().props.draft.selected.length, 0); assert.equal(ui.planner().props.draft.notes, ''); ui.unmount();
});
test('late responses cannot replace another section or disclose data after the active account changes', async () => {
  const pending = [];
  const ui = dashboardHarness({ request: (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal })) });
  ui.navigate('requests'); assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(state()); await ui.settle();
  pending[0].resolve(state('venue-1', { venues: [{ ...venues[0], name: 'Stale venue data' }] })); await ui.settle();
  assert.doesNotMatch(renderToStaticMarkup(ui.tree()), /Stale venue data/);
  ui.navigate('plan'); ui.session({ id: 'different-account' });
  pending[2].resolve(state('venue-1', { dancers: [{ id: 'secret', stage_name: 'Other account roster' }] })); await ui.settle();
  assert.equal(ui.planner(), undefined); ui.unmount(); assert.equal(pending[2].signal.aborted, true);
});
test('switching venues after an uncertain submission preserves each venue’s retry identity', async () => {
  const ui = dashboardHarness({ request: async (url, options) => {
    if (options.method === 'POST') throw new Error('Response lost');
    return state(new URL(url, 'https://example.test').searchParams.get('venueId') || venues[0].id);
  } });
  await ui.settle(); ui.navigate('plan'); await ui.settle();
  const draft = { selected: ['dancer-2'], date: '2027-01-15', time: '21:30', notes: '' };
  ui.planner().props.onChange(draft); ui.render(); await ui.planner().props.onSubmit(); await ui.settle();
  const switchVenue = value => ui.nodes().find(n => n.type === 'select' && n.props.value.startsWith('venue-')).props.onChange({ target: { value } });
  switchVenue(venues[1].id); await ui.settle(); ui.planner().props.onChange(draft); ui.render();
  await ui.planner().props.onSubmit(); await ui.settle();
  switchVenue(venues[0].id); await ui.settle(); await ui.planner().props.onSubmit(); await ui.settle();
  const posts = ui.calls.filter(c => c.options.method === 'POST').map(c => JSON.parse(c.options.body));
  assert.equal(posts[0].requestId, posts[2].requestId); assert.notEqual(posts[0].requestId, posts[1].requestId); ui.unmount();
});
test('planner labels current availability honestly, shows venue-local time, and prevents adding an eleventh dancer', () => {
  const Planner = compileVip('app/vip/VipPlan.tsx', { '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-dashboard': helpers }).default;
  const roster = Array.from({ length: 11 }, (_, i) => ({ id: String(i), stage_name: `Dancer ${i}`, working_now: i === 0 }));
  const html = renderToStaticMarkup(React.createElement(Planner, { venue: venues[0], dancers: roster, draft: { ...helpers.emptyVipDraft(), selected: roster.slice(0, 10).map(d => d.id) }, onChange() {}, onSubmit: async () => {}, busy: false }));
  assert.match(html, /America\/Los Angeles time/); assert.match(html, /Affiliated · off shift/);
  assert.match(html, /Availability for your visit is confirmed by the venue/);
  assert.equal((html.match(/type="checkbox" disabled=""/g) || []).length, 1);
  assert.match(html, /aria-label="Remove Dancer 0 from request"/);
});
