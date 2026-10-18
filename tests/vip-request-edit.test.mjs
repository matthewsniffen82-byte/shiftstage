import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardHarness, compileVip, venues, state, dancers } from './helpers/vip-dashboard-fixture.mjs';
import * as helpers from '../src/lib/dancr/vip-dashboard.ts';
import * as types from '../src/lib/dancr/vip-types.ts';

const pending = { id: 'request-1', venue_id: venues[0].id, guest_name: 'Jordan', status: 'pending',
  starts_at: '2027-01-16T05:30:00Z', timezone: venues[0].timezone, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-02T12:00:00.123456Z',
  dancers: [{ id: 'dancer-1', stageName: 'Aria' }], notes: '', response_note: '' };
const draft = { selected: ['dancer-2'], date: '2027-02-20', time: '22:00' };
const html = ui => renderToStaticMarkup(ui.tree());

test('edit opens the existing request in venue-local time, preserves a separate new draft, and saves to the same ID', async () => {
  const ui = dashboardHarness({ hash: '#vip-plan', request: async () => state(venues[0].id, { requests: [pending] }) });
  await ui.settle(); ui.planner().props.onChange(draft); ui.render();
  ui.navigate('requests'); await ui.settle(); ui.requests().props.onEdit(pending); await ui.settle();
  assert.equal(ui.planner().props.editing, true);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.planner().props.draft)), { selected: ['dancer-1'], date: '2027-01-15', time: '21:30' });
  assert.match(html(ui), /Edit your request|Save changes/);
  ui.planner().props.onChange({ ...draft, selected: ['dancer-3'] }); ui.render();
  await ui.planner().props.onSubmit(); await ui.settle();
  const writes = ui.calls.filter(c => c.options.method);
  assert.equal(writes.length, 1); assert.equal(writes[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(writes[0].options.body), { venueId: pending.venue_id, requestId: pending.id,
    expectedUpdatedAt: pending.updated_at, localStart: '2027-02-20T22:00', dancerIds: ['dancer-3'] });
  assert.match(html(ui), /Request updated/);
  ui.navigate('plan'); await ui.settle(); assert.equal(ui.planner().props.editing, false);
  assert.deepEqual(ui.planner().props.draft, draft); ui.unmount();
});

test('cancel editing sends nothing and returns to requests; venue switching and navigation discard the edit', async () => {
  const ui = dashboardHarness({ hash: '#vip-requests', request: async url => state(new URL(url, 'https://example.test').searchParams.get('venueId') || venues[0].id, { requests: [pending] }) });
  await ui.settle(); ui.requests().props.onEdit(pending); await ui.settle();
  ui.planner().props.onChange(draft); ui.render(); ui.planner().props.onCancelEdit(); await ui.settle();
  assert.ok(ui.requests()); assert.equal(ui.calls.some(c => c.options.method), false);
  ui.requests().props.onEdit(pending); await ui.settle();
  ui.nodes().find(n => n.type === 'select').props.onChange({ target: { value: venues[1].id } }); await ui.settle();
  assert.equal(ui.planner().props.editing, false); assert.equal(ui.planner().props.draft.date, '');
  ui.unmount();
});

test('failed edits retain input, duplicate saves are blocked, and late responses after account changes are ignored', async () => {
  let rejectSave, resolveSave;
  const ui = dashboardHarness({ hash: '#vip-requests', request: async (_url, options) => options.method === 'PUT'
    ? new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }) : state(venues[0].id, { requests: [pending] }) });
  await ui.settle(); ui.requests().props.onEdit(pending); await ui.settle();
  ui.planner().props.onChange(draft); ui.render();
  const first = ui.planner().props.onSubmit(); ui.render(); await ui.planner().props.onSubmit();
  assert.equal(ui.calls.filter(c => c.options.method === 'PUT').length, 1);
  rejectSave(new Error('Request changed. Reopen it.')); await first; await ui.settle();
  assert.deepEqual(ui.planner().props.draft, draft); assert.equal(ui.planner().props.editing, true);
  assert.match(html(ui), /Request changed/);
  const second = ui.planner().props.onSubmit(); ui.session({ id: 'different-account' }); resolveSave({}); await second; await ui.settle();
  assert.doesNotMatch(html(ui), /Request updated/); ui.unmount();
});

test('only pending guest cards offer editing, and midnight conversion uses 00 rather than 24', () => {
  const Cards = compileVip('app/vip/VipRequests.tsx', { '@/src/lib/dancr/vip-types': types }).default;
  for (const status of ['pending','confirmed','declined','cancelled']) {
    const markup = renderToStaticMarkup(React.createElement(Cards, { requests: [{ ...pending, status }], onEdit() {} }));
    assert.equal(markup.includes('Edit request'), status === 'pending');
  }
  const manager = renderToStaticMarkup(React.createElement(Cards, { requests: [pending], onEdit() {}, onReview() {} }));
  assert.doesNotMatch(manager, /Edit request/);
  assert.equal(helpers.vipRequestDraft({ ...pending, starts_at: '2027-01-16T08:00:00Z' }).time, '00:00');
  assert.equal(helpers.vipRequestDraft(pending, 'America/New_York').time, '00:30');
  const Planner = compileVip('app/vip/VipPlan.tsx', { '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-dashboard': helpers }).default;
  const markup = renderToStaticMarkup(React.createElement(Planner, { venue: venues[0], dancers, draft, editing: true, unavailableSelections: true, busy: false, followPending: [] }));
  assert.match(markup, /Save changes/); assert.match(markup, /Cancel editing/); assert.doesNotMatch(markup, /Send request to venue/);
  assert.match(markup, /Review your selection before saving/);
});
