import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardHarness, compileVip, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import { readVipWorkspace, saveVipWorkspace, VIP_DRAFT_PREFIX } from '../src/lib/dancr/vip-draft-storage.ts';
import { vipCalendar } from '../src/lib/dancr/vip-calendar.ts';
import * as types from '../src/lib/dancr/vip-types.ts';
import { BROWSER_AUTH_SESSION_KEY, clearBrowserAuthSession, persistBrowserAuthSession } from '../src/lib/dancr/browser-session.ts';

const draft = { selected: ['dancer-2'], date: '2027-01-15', time: '21:30' };
const visit = { id: 'request-1', venue_id: venues[0].id, guest_name: 'Jordan', status: 'confirmed',
  starts_at: '2027-01-16T05:30:00Z', created_at: '2026-10-01T12:00:00Z', timezone: venues[0].timezone,
  dancers: [{ id: 'dancer-1', stageName: 'Aria' }], notes: '', response_note: '' };
const storageAdapter = values => ({ get length() { return values.size; }, key: i => [...values.keys()][i],
  getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) });

test('drafts and retry identity survive a reload, stay venue-scoped, and clear after success', async () => {
  const storage = new Map();
  const first = dashboardHarness({ hash: '#vip-plan', storage, request: async (_url, options) => {
    if (options.method === 'POST') throw new Error('Response lost'); return state();
  } });
  await first.settle(); first.planner().props.onChange(draft); first.render();
  await first.planner().props.onSubmit(); await first.settle();
  const sent = JSON.parse(first.calls.find(call => call.options.method === 'POST').options.body); first.unmount();
  const second = dashboardHarness({ hash: '#vip-plan', storage }); await second.settle();
  assert.deepEqual(second.planner().props.draft, draft);
  await second.planner().props.onSubmit(); await second.settle();
  assert.equal(JSON.parse(second.calls.find(call => call.options.method === 'POST').options.body).requestId, sent.requestId);
  assert.equal(storage.size, 0); second.unmount();
});

test('storage rejects expired, malformed and other-account drafts without blocking the planner', () => {
  const values = new Map(), storage = storageAdapter(values);
  saveVipWorkspace(storage, 'guest', { drafts: { 'venue-1': draft }, retries: {} });
  assert.deepEqual(readVipWorkspace(storage, 'other').drafts, {});
  const saved = JSON.parse(values.get(VIP_DRAFT_PREFIX + 'guest'));
  assert.deepEqual(readVipWorkspace(storage, 'guest', saved.savedAt + 86400001).drafts, {});
  values.set(VIP_DRAFT_PREFIX + 'guest', '{invalid'); assert.deepEqual(readVipWorkspace(storage, 'guest').drafts, {});
  values.set(VIP_DRAFT_PREFIX + 'guest', JSON.stringify({ ...saved, drafts: { venue: { ...draft, selected: Array(11).fill('x') } } }));
  assert.deepEqual(readVipWorkspace(storage, 'guest').drafts, {});
  assert.doesNotThrow(() => saveVipWorkspace({ setItem() { throw Error('denied'); } }, 'guest', { drafts: { venue: draft }, retries: {} }));
});

test('logout and account switching erase VIP drafts but a same-account token refresh preserves them', () => {
  const previous = globalThis.window, values = new Map();
  globalThis.window = { localStorage: storageAdapter(values), navigator: {} };
  try {
    const signIn = id => persistBrowserAuthSession({ accessToken: `token-${id}`, account: { id, role: 'customer' } });
    signIn('guest'); values.set(VIP_DRAFT_PREFIX + 'guest', 'private'); values.set('unrelated-preference', 'keep');
    assert.equal(signIn('guest'), true); assert.equal(values.get(VIP_DRAFT_PREFIX + 'guest'), 'private');
    signIn('other'); assert.equal(values.has(VIP_DRAFT_PREFIX + 'guest'), false);
    values.set(VIP_DRAFT_PREFIX + 'other', 'private'); clearBrowserAuthSession();
    assert.equal(values.has(VIP_DRAFT_PREFIX + 'other'), false); assert.equal(values.get('unrelated-preference'), 'keep');
    values.set(BROWSER_AUTH_SESSION_KEY, '{corrupt'); assert.equal(signIn('guest'), true);
  } finally { globalThis.window = previous; }
});

test('homepage sign-out and account switching also erase VIP drafts', () => {
  const source = readFileSync('src/live-shell/app/02-record-live-event.js', 'utf8');
  const values = new Map(), storage = storageAdapter(values);
  const context = { localStorage: storage, authSession: { account: { id: 'guest' } },
    browserAccountIdentity: session => session?.account?.id || '', clearCustomerPushDevice() {},
    normalizeAccountEmail: () => '', updateCurrentEmailDisplays() {}, persistAccountEmail() {} };
  vm.runInNewContext(source.slice(source.indexOf('    function saveAuthSession('), source.indexOf('    async function endAuthSession(')), context);
  values.set(VIP_DRAFT_PREFIX + 'guest', 'private');
  context.saveAuthSession({ account: { id: 'guest' } }); assert.equal(values.get(VIP_DRAFT_PREFIX + 'guest'), 'private');
  context.saveAuthSession({ account: { id: 'other' } }); assert.equal(values.has(VIP_DRAFT_PREFIX + 'guest'), false);
  values.set(VIP_DRAFT_PREFIX + 'other', 'private'); context.saveAuthSession(null); assert.equal(values.has(VIP_DRAFT_PREFIX + 'other'), false);
});

test('refresh keeps the current section visible, updates on return, and pauses in background tabs', async () => {
  let resolveRefresh, calls = 0;
  const ui = dashboardHarness({ request: async () => ++calls === 1 ? state() : new Promise(resolve => { resolveRefresh = resolve; }) });
  await ui.settle(); ui.advance(16000); ui.event('focus');
  assert.match(renderToStaticMarkup(ui.tree()), /Welcome, Jordan/);
  assert.match(renderToStaticMarkup(ui.tree()), /Updating your lounge/);
  resolveRefresh(state('venue-1', { summary: { pending: 8, upcoming: 0, nextVisit: null } })); await ui.settle();
  assert.match(renderToStaticMarkup(ui.tree()), /<strong>8<\/strong>/);
  ui.advance(61000); ui.visible(false); ui.tick(); assert.equal(calls, 2);
  ui.visible(true); ui.event('visibilitychange'); assert.equal(calls, 3);
  resolveRefresh(state()); await ui.settle(); ui.unmount(); assert.equal(ui.intervals.size, 0);
});

test('refresh errors retain retryable content, but revoked access removes it', async () => {
  let failure = null;
  const ui = dashboardHarness({ request: async () => { if (failure) throw failure; return state(); } });
  await ui.settle(); failure = new Error('Temporarily unavailable'); ui.advance(16000); ui.event('focus'); await ui.settle();
  assert.match(renderToStaticMarkup(ui.tree()), /Welcome, Jordan/); assert.match(renderToStaticMarkup(ui.tree()), /Temporarily unavailable/);
  failure = Object.assign(new Error('Access revoked'), { status: 403 }); ui.advance(16000); ui.event('focus'); await ui.settle();
  assert.doesNotMatch(renderToStaticMarkup(ui.tree()), /Welcome, Jordan/); ui.unmount();
});

test('confirmed summary opens its filter and repeat requests merge selections without sending a request', async () => {
  const ui = dashboardHarness({ request: async () => state('venue-1', { requests: [visit] }) }); await ui.settle();
  ui.nodes().find(node => node.props?.className === 'vip-summary-card' && renderToStaticMarkup(node).includes('Upcoming visits')).props.onClick();
  await ui.settle(); assert.match(ui.calls.at(-1).url, /status=confirmed/);
  ui.navigate('plan'); await ui.settle(); ui.planner().props.onChange(draft); ui.render();
  ui.navigate('requests'); await ui.settle(); ui.requests().props.onRepeat(visit); await ui.settle();
  assert.deepEqual(Array.from(ui.planner().props.draft.selected), ['dancer-2', 'dancer-1']);
  assert.equal(ui.planner().props.draft.date, draft.date); assert.equal(ui.calls.some(c => c.options.method === 'POST'), false); ui.unmount();
});

test('guest withdrawal blocks duplicate writes, remains retryable and ignores changed accounts', async () => {
  let resolveWrite;
  const pending = { ...visit, status: 'pending' };
  const ui = dashboardHarness({ hash: '#vip-requests', request: async (_url, options) => options.method === 'DELETE'
    ? new Promise(resolve => { resolveWrite = resolve; }) : state('venue-1', { requests: [pending] }) });
  await ui.settle(); const first = ui.requests().props.onWithdraw(pending); ui.render();
  assert.equal(await ui.requests().props.onWithdraw(pending), false);
  assert.equal(ui.calls.filter(c => c.options.method === 'DELETE').length, 1);
  ui.session({ id: 'other' }); resolveWrite({}); assert.equal(await first, false); await ui.settle();
  assert.doesNotMatch(renderToStaticMarkup(ui.tree()), /Request withdrawn/); ui.unmount();
});

test('calendar downloads preserve UTC time, escape text, fold UTF-8, and omit private guest details', () => {
  const calendar = vipCalendar(visit, 'Club, One;\n' + '舞'.repeat(80));
  assert.match(calendar, /DTSTART:20270116T053000Z/); assert.match(calendar, /DTSTAMP:20261001T120000Z/);
  assert.match(calendar, /SUMMARY:VIP visit · Club\\, One\\;\\n/);
  assert.doesNotMatch(calendar, /Jordan|Aria|DTEND/);
  assert.ok(calendar.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.equal(vipCalendar({ ...visit, status: 'pending' }, 'Club'), '');
});

test('guest request cards offer calendars only when confirmed and require an explicit withdrawal click', async () => {
  let slot = 0; const values = [], withdrawals = [];
  const Cards = compileVip('app/vip/VipRequests.tsx', { react: { useState(initial) { const i = slot++; if (!(i in values)) values[i] = initial; return [values[i], next => { values[i] = next; }]; } },
    '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-calendar': { vipCalendar } }).default;
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : [];
  const list = Cards({ requests: [{ ...visit, status: 'pending' }], venueName: 'Club', onWithdraw: async r => { withdrawals.push(r.id); return true; } });
  const card = list.props.children[0]; const render = () => { slot = 0; return card.type(card.props); };
  let tree = render(); assert.equal(nodes(tree).some(n => n.props?.download), false);
  nodes(tree).find(n => n.props?.children === 'Withdraw request').props.onClick(); tree = render();
  assert.equal(withdrawals.length, 0); await nodes(tree).find(n => n.props?.children === 'Yes, withdraw').props.onClick();
  assert.deepEqual(withdrawals, [visit.id]);
  const RealCards = compileVip('app/vip/VipRequests.tsx', { '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-calendar': { vipCalendar } }).default;
  const html = renderToStaticMarkup(React.createElement(RealCards, { requests: [visit], venueName: 'Club', featured: true }));
  assert.match(html, /download="mydancr-visit-request-1.ics"/); assert.match(html, /vip-request-featured/);
});
