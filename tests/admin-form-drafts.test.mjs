import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import ts from 'typescript';
import { ADMIN_DRAFT_PREFIX, readAdminDraft, writeAdminDraft } from '../app/admin/admin-form-drafts.ts';

const require = createRequire(import.meta.url);
const ui = readFileSync(new URL('../app/admin/AdminClient.tsx', import.meta.url), 'utf8');
const page = { name: 'Rhino draft', address: '3340 S Highland Dr', city: 'Las Vegas', state: 'NV', phone: '702-555-0100', website: 'https://example.test', timezone: 'America/Los_Angeles', opensAt: '00:00', closesAt: '00:00', transportEnabled: 'yes' };
const deal = { venueId: 'club-a', dealId: 'deal-a', requestId: '', dealTitle: 'Free admission', dealDescription: 'Draft admission details', dealTerms: 'Draft guest terms', sortOrder: '2', isActive: false };
function storage() {
  const data = new Map();
  return { data, get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}

test('page and deal entries survive a new read and stay isolated by account, club and form', () => {
  const s = storage();
  assert.equal(writeAdminDraft(s, 'admin-a', 'club-page', 'club-a', page), true);
  assert.equal(writeAdminDraft(s, 'admin-a', 'club-deal', 'club-a', deal), true);
  assert.deepEqual(readAdminDraft(s, 'admin-a', 'club-page', 'club-a'), page);
  assert.deepEqual(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a'), deal);
  assert.equal(readAdminDraft(s, 'admin-b', 'club-page', 'club-a'), null);
  assert.equal(readAdminDraft(s, 'admin-a', 'club-page', 'club-b'), null);
});

test('drafts retain empty entries and unchecked publication state; only form fields are stored', () => {
  const s = storage();
  writeAdminDraft(s, 'admin-a', 'club-deal', 'club-a', { ...deal, dealTerms: '', password: 'never-store', accessToken: 'never-store' });
  assert.equal(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a').dealTerms, '');
  assert.equal(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a').isActive, false);
  assert.doesNotMatch([...s.data.values()][0], /password|accessToken|never-store/);
  writeAdminDraft(s, 'admin-a', 'club-deal', 'club-a', null);
  assert.equal(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a'), null);
});

test('drafts survive later refreshes while malformed, future-dated and oversized data is ignored safely', () => {
  const s = storage(), now = 100000000;
  writeAdminDraft(s, 'admin-a', 'club-page', 'club-a', page, now);
  assert.deepEqual(readAdminDraft(s, 'admin-a', 'club-page', 'club-a', now + 86400001), page);
  writeAdminDraft(s, 'admin-a', 'club-page', 'club-a', page, now + 1);
  assert.equal(readAdminDraft(s, 'admin-a', 'club-page', 'club-a', now), null);
  writeAdminDraft(s, 'admin-a', 'club-page', 'club-a', page, now);
  const key = s.key(0);
  for (const value of ['{broken', 'x'.repeat(50001), JSON.stringify({ accountId: 'other', scope: 'club-a', kind: 'club-page', savedAt: now, value: page })]) {
    s.setItem(key, value);
    assert.equal(readAdminDraft(s, 'admin-a', 'club-page', 'club-a', now), null);
  }
  assert.equal(writeAdminDraft(s, 'admin-a', 'club-page', 'club-a', { ...page, name: 'x'.repeat(4001) }), false);
  const blocked = { ...s, getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.equal(readAdminDraft(blocked, 'admin-a', 'club-page', 'club-a'), null);
  assert.equal(writeAdminDraft(blocked, 'admin-a', 'club-page', 'club-a', page), false);
});

const walk = node => Array.isArray(node) ? node.flatMap(walk) : React.isValidElement(node) ? [node, ...walk(node.props.children)] : [];
const venue = { id: 'club-a', name: 'Saved club', city: 'Las Vegas', state: 'NV', address: 'Saved address', phone: 'Saved phone', website: '', timezone: 'America/Los_Angeles', opens_at: '20:00', closes_at: '04:00', transport_enabled: false, is_active: false, page_review_status: 'admin_draft' };
const savedDeal = { id: 'deal-a', venueId: 'club-a', dealTitle: 'Free admission', dealDescription: 'Saved description', dealTerms: 'Saved terms', sortOrder: 0, isActive: true };
const preset = { title: 'Free admission', description: 'Preset description', terms: 'Preset terms' };
function fixture(name, s, { fail = false, accountId = 'admin-a', club = venue, deals = [savedDeal] } = {}) {
  const start = ui.indexOf('function ' + name + '(');
  const source = ui.slice(start, ui.indexOf('\nfunction ', start + 1));
  const output = ts.transpileModule('export ' + source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const states = [], effects = [], exports = {}, requests = [];
  let cursor = 0, mounted = false;
  const props = { scopedVenueId: club.id, venues: [club], claimCodes: [], clubDeals: deals, dealRequests: [],
    onClubDealsChange(rows) { props.clubDeals = rows; }, onDealRequestsChange() {}, onActionConfirmed() {},
    onVenuesChange(rows) { props.venues = rows; }, onClaimCodesChange() {}, onOpenOperations() {} };
  const context = { exports, require, AbortController, URLSearchParams, console,
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; },
    useEffect(fn) { if (!mounted) effects.push(fn); }, useAdminCommercialEditorState() {},
    loadAdminFormDraft: (kind, scope) => readAdminDraft(s, accountId, kind, scope),
    saveAdminFormDraft: (kind, scope, value) => writeAdminDraft(s, accountId, kind, scope, value),
    defaultClubDealOfferPreset: () => preset, CLUB_DEAL_OFFER_PRESETS: [preset],
    asText: value => String(value ?? ''), asRecordObject: value => value || {},
    findAvailableMyDancrCity: value => value === 'Las Vegas' ? value : null,
    MYDANCR_AVAILABLE_CITIES: ['Las Vegas'], venuePagePreviewHref: () => '/preview', formatDate: String,
    FormData: class { constructor(values) { return new Map(Object.entries(values)); } },
    window: { confirm: () => true, requestAnimationFrame: () => 1, cancelAnimationFrame() {} },
    document: { getElementById: () => ({ reset() { form().props.onReset(); } }) },
    async requestAdminJson(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      if (fail) throw Error('Save failed');
      return { venue: { ...club, name: page.name, opens_at: page.opensAt, closes_at: page.closesAt },
        deal: savedDeal, clubDeals: deals, dealRequests: [] };
    },
  };
  for (const match of source.matchAll(/<([A-Z]\w*)[\s>]/g)) context[match[1]] ||= match[1];
  vm.runInNewContext(output, context);
  function render() { cursor = 0; const tree = exports[name](props); if (!mounted) { mounted = true; effects.forEach(fn => fn()); } return tree; }
  const nodes = () => walk(render());
  const form = () => nodes().find(node => node.type === 'form' && ['venue-page-editor', 'admin-club-deal-form'].includes(node.props.className));
  return { nodes, form, requests, props, render };
}

test('club page remount restores all entered fields and keeps sending for approval blocked', () => {
  const s = storage(), first = fixture('VenueManager', s);
  first.form().props.onChange({ target: { getAttribute: () => 'name' }, currentTarget: page });
  const refreshed = fixture('VenueManager', s);
  for (const name of ['name', 'address', 'city', 'state', 'phone', 'website', 'timezone', 'transportEnabled']) {
    assert.equal(refreshed.nodes().find(node => node.props.name === name).props.defaultValue, page[name]);
  }
  const hours = refreshed.nodes().find(node => node.type === 'AdminClubHoursFields');
  assert.equal(hours.props.opensAt, '00:00'); assert.equal(hours.props.closesAt, '00:00');
  assert.equal(refreshed.form().props['data-admin-unsaved'], true);
  assert.equal(refreshed.nodes().find(node => node.type === 'button' && node.props.children === 'Send for approval').props.disabled, true);
  assert.equal(refreshed.requests.length, 0, 'restoring must never save or publish automatically');
});

test('hours callback saves the newly chosen mode, even before hidden form fields rerender', () => {
  const s = storage(), f = fixture('VenueManager', s);
  f.nodes().find(node => node.type === 'AdminClubHoursFields').props.onHoursChange({ opensAt: '00:00', closesAt: '00:00' }, { ...page, opensAt: '20:00', closesAt: '04:00' });
  assert.equal(readAdminDraft(s, 'admin-a', 'club-page', 'club-a').opensAt, '00:00');
  assert.equal(readAdminDraft(s, 'admin-a', 'club-page', 'club-a').closesAt, '00:00');
});

test('selected days recover, submit, and reset to the saved club schedule', async () => {
  const s = storage(), f = fixture('VenueManager', s, { club: { ...venue, open_days: [1, 2, 3, 4, 5] } });
  f.nodes().find(node => node.type === 'AdminClubHoursFields').props.onHoursChange({ opensAt: '20:00', closesAt: '04:00', openDays: '5,6' }, { ...page, openDays: '1,2,3,4,5' });
  assert.equal(readAdminDraft(s, 'admin-a', 'club-page', 'club-a').openDays, '5,6');
  const refreshed = fixture('VenueManager', s, { club: { ...venue, open_days: [1, 2, 3, 4, 5] } });
  assert.deepEqual(Array.from(refreshed.nodes().find(node => node.type === 'AdminClubHoursFields').props.openDays), [5, 6]);
  refreshed.form().props.onSubmit({ preventDefault() {}, currentTarget: { ...page, openDays: '5,6' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(refreshed.requests[0].body.openDays, [5, 6]);
  f.form().props.onReset();
  assert.deepEqual(Array.from(f.nodes().find(node => node.type === 'AdminClubHoursFields').props.openDays), [1, 2, 3, 4, 5]);
});

test('cancelling page changes drops the recovery draft and remounts saved fields', () => {
  const s = storage(); writeAdminDraft(s, 'admin-a', 'club-page', 'club-a', page);
  const f = fixture('VenueManager', s), key = f.form().key;
  f.nodes().find(node => node.type === 'button' && node.props.children === 'Cancel changes').props.onClick();
  assert.equal(readAdminDraft(s, 'admin-a', 'club-page', 'club-a'), null);
  assert.notEqual(f.form().key, key);
  assert.equal(f.nodes().find(node => node.props.name === 'name').props.defaultValue, venue.name);
  assert.equal(f.form().props['data-admin-unsaved'], false);
});

test('failed page saves retain recovery; confirmed saves clear it', async () => {
  for (const fail of [true, false]) {
    const s = storage(); writeAdminDraft(s, 'admin-a', 'club-page', 'club-a', page);
    const f = fixture('VenueManager', s, { fail });
    f.form().props.onSubmit({ preventDefault() {}, currentTarget: page });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(Boolean(readAdminDraft(s, 'admin-a', 'club-page', 'club-a')), fail);
    assert.equal(f.form().props['data-admin-unsaved'], fail);
  }
});

test('deal remount restores exact terms and publication choice without a request or duplicate remove button', () => {
  const s = storage(); writeAdminDraft(s, 'admin-a', 'club-deal', 'club-a', deal);
  const f = fixture('AdminClubDealManager', s);
  for (const name of ['dealTitle', 'dealDescription', 'dealTerms', 'sortOrder']) assert.equal(f.nodes().find(node => node.props.name === name).props.value, deal[name]);
  assert.equal(f.nodes().find(node => node.props.name === 'isActive').props.checked, false);
  assert.equal(f.form().props['data-admin-unsaved'], true);
  assert.equal(f.nodes().filter(node => node.type === 'button' && node.props.children === 'Remove deal').length, 1);
  assert.equal(f.requests.length, 0);
});

test('deal changes write the latest event immediately; failure retains them and success clears them', async () => {
  for (const fail of [true, false]) {
    const s = storage(); writeAdminDraft(s, 'admin-a', 'club-deal', 'club-a', deal);
    const f = fixture('AdminClubDealManager', s, { fail });
    const form = f.form();
    f.nodes().find(node => node.props.name === 'dealTerms').props.onChange({ target: { value: 'Latest character!' } });
    form.props.onChangeCapture();
    const values = { ...deal, dealTerms: 'Latest character!' }; delete values.isActive;
    form.props.onChange({ target: { getAttribute: () => 'dealTerms' }, currentTarget: values });
    assert.equal(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a').dealTerms, 'Latest character!');
    assert.equal(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a').isActive, false);
    await f.form().props.onSubmit({ preventDefault() {} });
    assert.equal(Boolean(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a')), fail);
  }
});

test('deleted deals are not restored and choosing a new deal clears the old recovery draft', () => {
  const s = storage(); writeAdminDraft(s, 'admin-a', 'club-deal', 'club-a', deal);
  assert.equal(fixture('AdminClubDealManager', s, { deals: [] }).form().props['data-admin-unsaved'], false);
  const f = fixture('AdminClubDealManager', s);
  f.nodes().find(node => node.type === 'button' && node.props.children === 'New deal').props.onClick();
  assert.equal(readAdminDraft(s, 'admin-a', 'club-deal', 'club-a'), null);
  assert.equal(f.form().props['data-admin-unsaved'], false);
});

test('the selected saved deal reopens using current server values after refresh', () => {
  const s = storage();
  const other = { ...savedDeal, id: 'deal-b', dealDescription: 'Second saved deal' };
  const f = fixture('AdminClubDealManager', s, { deals: [savedDeal, other] });
  f.nodes().filter(node => node.props.className === 'admin-club-deal-edit')[1].props.onClick();
  const latest = { ...other, dealDescription: 'Updated on server' };
  const refreshed = fixture('AdminClubDealManager', s, { deals: [savedDeal, latest] });
  assert.equal(refreshed.nodes().find(node => node.props.name === 'dealDescription').props.value, 'Updated on server');
  assert.equal(refreshed.form().props['data-admin-unsaved'], false);
  const single = fixture('AdminClubDealManager', storage());
  assert.equal(single.nodes().find(node => node.props.name === 'dealDescription').props.value, savedDeal.dealDescription);
});

test('sign-out and account replacement clear form drafts; login fields are outside persistence', () => {
  assert.match(ui, /function signOut\(\) \{\s+clearAdminFormDrafts\(\)/);
  assert.match(ui, /browserAccountRef\.current = identity;\s+clearAdminFormDrafts\(\)/);
  assert.ok(ADMIN_DRAFT_PREFIX.startsWith('mydancr:admin-form:'));
});

test('daily hours recover, submit, and reset to the saved weekly schedule', async () => {
 const weeklyHours=Array.from({length:7},(_,day)=>day===5?{mode:'custom',opensAt:'22:00',closesAt:'06:00'}:{mode:'closed'});
 const s=storage(), f=fixture('VenueManager',s,{club:{...venue,weekly_hours:weeklyHours}});
 const changed=weeklyHours.map((day,index)=>index===6?{mode:'24-hours'}:day), json=JSON.stringify(changed);
 f.nodes().find(node=>node.type==='AdminClubHoursFields').props.onHoursChange({opensAt:'22:00',closesAt:'06:00',openDays:'5,6',weeklyHours:json},{...page,weeklyHours:JSON.stringify(weeklyHours)});
 assert.equal(readAdminDraft(s,'admin-a','club-page','club-a').weeklyHours,json);
 const refreshed=fixture('VenueManager',s,{club:{...venue,weekly_hours:weeklyHours}});
 assert.equal(refreshed.nodes().find(node=>node.type==='AdminClubHoursFields').props.weeklyHoursDraft,json);
 refreshed.form().props.onSubmit({preventDefault(){},currentTarget:{...page,weeklyHours:json}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(refreshed.requests[0].body.weeklyHours,changed);
 f.form().props.onReset();
 assert.deepEqual(f.nodes().find(node=>node.type==='AdminClubHoursFields').props.weeklyHours,weeklyHours);
});
