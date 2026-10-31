import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { startVisibleAutoRefresh } from '../src/lib/visible-auto-refresh.ts';
import { mergeLiveRows } from '../src/lib/merge-live-rows.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function events() {
  const listeners = new Map();
  return { listeners, addEventListener(name, callback) { const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); }, fire(name) { for (const callback of listeners.get(name) || []) callback(); } };
}
function environment() {
  const timers = new Map(), page = { ...events(), visibilityState: 'visible' };
  const host = { ...events(), setInterval(callback, delay) { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; }, clearInterval(id) { timers.delete(id); } };
  return { page, host, timers, pulse() { for (const timer of timers.values()) timer.callback(); } };
}

for (const intervalMs of [30_000, 60_000]) test(`visible polling uses ${intervalMs}ms, return events, and cleanup`, async () => {
  const env = environment(), calls = [];
  const stop = startVisibleAutoRefresh({ ...env, intervalMs, refresh: async signal => { calls.push(signal); } });
  assert.equal([...env.timers.values()][0].delay, intervalMs);
  env.pulse(); await tick(); assert.equal(calls.length, 1);
  env.page.visibilityState = 'hidden'; env.pulse(); env.host.fire('focus'); await tick(); assert.equal(calls.length, 1);
  env.page.visibilityState = 'visible';
  for (const event of ['focus', 'pageshow', 'online']) { env.host.fire(event); await tick(); }
  env.page.fire('visibilitychange'); await tick(); assert.equal(calls.length, 5);
  stop(); env.pulse(); env.host.fire('focus'); await tick(); assert.equal(calls.length, 5);
  assert.equal(env.timers.size, 0);
  assert.ok([...env.host.listeners.values(), ...env.page.listeners.values()].every(set => set.size === 0));
});

test('slow reads never overlap, hidden/abandoned reads are aborted, and errors retry', async () => {
  const env = environment(), first = deferred(), calls = [];
  const stop = startVisibleAutoRefresh({ ...env, refresh: signal => { calls.push(signal); return calls.length === 1 ? first.promise : Promise.reject(new Error('offline')); } });
  env.pulse(); env.pulse(); env.host.fire('focus'); assert.equal(calls.length, 1);
  env.page.visibilityState = 'hidden'; env.page.fire('visibilitychange'); assert.equal(calls[0].aborted, true);
  first.resolve(); await tick(); env.page.visibilityState = 'visible'; env.host.fire('focus'); await tick();
  env.pulse(); await tick(); assert.equal(calls.length, 3); stop();
  const second = deferred(); let signal;
  const cleanup = startVisibleAutoRefresh({ ...env, refresh: value => { signal = value; return second.promise; } });
  env.pulse(); cleanup(); assert.equal(signal.aborted, true); second.resolve(); await tick();
});

test('hook uses the latest callback, invalidates changed scopes/accounts, and cleans up inactive panels', async () => {
  const env = environment(), slots = []; let cursor = 0, effects = [], account = { id: 'one', role: 'admin' };
  const hooks = { useRef(current) { const index = cursor++; return slots[index] ||= { current }; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!deps || !old || deps.some((value, i) => value !== old.deps[i])) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); } };
  const library = {};
  vm.runInNewContext(compile(read('app/components/useVisibleAutoRefresh.ts')), { exports: library, require: name => name === 'react' ? hooks : name.endsWith('/browser-session') ? { readBrowserAuthSession: () => ({ account }) } : { startVisibleAutoRefresh: options => startVisibleAutoRefresh({ ...options, ...env }) } });
  const render = props => { cursor = 0; effects = []; library.useVisibleAutoRefresh(props); effects.forEach(effect => effect()); };
  const first = deferred(); let signal, current, latest = 0;
  render({ active: true, scopeKey: 'a', refresh: async (value, check) => { signal = value; current = check; await first.promise; } });
  env.pulse(); assert.equal(current(), true); account = { id: 'two', role: 'admin' }; assert.equal(current(), false);
  render({ active: true, scopeKey: 'b', refresh: async () => { latest++; } }); assert.equal(signal.aborted, true);
  first.resolve(); await tick(); env.pulse(); await tick(); assert.equal(latest, 1);
  render({ active: true, scopeKey: 'b', refresh: async () => { latest += 2; } }); env.pulse(); await tick(); assert.equal(latest, 3);
  render({ active: false, scopeKey: 'b', refresh: async () => {} }); assert.equal(env.timers.size, 0);
});

test('live row updates preserve order and dirty revisions while adding and removing other rows', () => {
  const current = [{ id: 'a', revision: 1 }, { id: 'draft', revision: 1 }, { id: 'removed' }];
  assert.deepEqual(mergeLiveRows(current, [{ id: 'new' }, { id: 'draft', revision: 2 }, { id: 'a', revision: 2 }], new Set(['draft'])),
    [{ id: 'a', revision: 2 }, current[1], { id: 'new' }]);
  assert.deepEqual(mergeLiveRows(current, [], new Set(['draft'])), [current[1]]);
  assert.deepEqual(mergeLiveRows(current, []), []);
});

// Evaluate the actual component refresh callbacks with controlled requests, without a browser.
function poll(path, values, after = '') {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call;
  const visit = node => { if (!call && ts.isCallExpression(node) && node.expression.getText(ast) === 'useVisibleAutoRefresh' && node.pos > source.indexOf(after)) call = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(call, path);
  let options;
  const context = vm.createContext({ AbortSignal, AbortController, URLSearchParams, Error, mergeLiveRows, ...values, useVisibleAutoRefresh: value => { options = value; } });
  vm.runInContext(compile(call.getText(ast)), context);
  return { options, context, run: (isCurrent = () => true) => options.refresh(new AbortController().signal, isCurrent) };
}

function customerFixture() {
  const saved = { follows: [], venueFollows: [], goingSignals: [] }, pending = deferred(); let result = saved, calls = 0;
  const f = poll('app/dashboard/CustomerDashboardPanels.tsx', { isLoading: false, view: 'night', confirmedSaved: saved,
    actionInFlightRef: { current: false }, actionSequenceRef: { current: 0 },
    requestDashboardJson: () => { calls++; return pending.promise; }, onSavedChange: apply => { result = apply(result); } });
  return { ...f, saved, pending, result: () => result, calls: () => calls, replace: value => { result = value; } };
}
test('customer followed status updates while idle and preserves concurrent saved changes', async () => {
  const f = customerFixture(); assert.equal(f.options.active, true);
  const refreshing = f.run(); f.pending.resolve({ saved: { ...f.saved, follows: [{ dancerId: 'new', dancer: { workingNow: true } }] } }); await refreshing;
  assert.equal(f.result().follows[0].dancerId, 'new');
  const concurrent = customerFixture(), pending = concurrent.run(), updated = { ...concurrent.saved, goingSignals: [{ shiftId: 'mine' }] };
  concurrent.replace(updated); concurrent.pending.resolve({ saved: concurrent.saved }); await pending; assert.equal(concurrent.result(), updated);
});
for (const race of ['action', 'account']) test(`customer refresh cannot overwrite a newer ${race}`, async () => {
  const f = customerFixture(); let current = true; const pending = f.run(() => current);
  if (race === 'action') f.context.actionSequenceRef.current++; else current = false;
  f.pending.resolve({ saved: { follows: [{ dancerId: 'stale' }] } }); await pending; assert.equal(f.result(), f.saved);
  f.context.actionInFlightRef.current = true; await f.run(); assert.equal(f.calls(), 1);
});

test('pickup refresh reloads every loaded page without clearing rows or changing filters', async () => {
  const requests = Array.from({ length: 4 }, (_, id) => ({ id: String(id) })), calls = []; let shown = requests, more;
  const f = poll('app/pickups/PickupInbox.tsx', { query: 'venueId=club', loading: false, paginationLock: { current: false }, readVersion: { current: 1 }, requests,
    requestPickupJson: async url => { calls.push(url); return { phoneRequests: calls.length === 1 ? [{ id: '0' }, { id: '1' }] : [{ id: '2' }, { id: '3' }], hasMorePhoneRequests: true }; },
    setRequests: value => { shown = value; }, setMore: value => { more = value; }, setError() {} });
  await f.run(); assert.equal(calls.length, 2); assert.ok(calls[1].endsWith('venueId=club&phoneOffset=2')); assert.equal(shown.length, 4); assert.equal(more, true);
});
for (const lock of ['manual', 'pagination']) test(`pickup polling drops reads superseded by ${lock}`, async () => {
  const pending = deferred(); let applied = false;
  const f = poll('app/pickups/PickupInbox.tsx', { query: '', loading: false, paginationLock: { current: false }, readVersion: { current: 1 }, requests: [],
    requestPickupJson: () => pending.promise, setRequests: () => { applied = true; }, setMore() {}, setError() {} });
  const refresh = f.run(); if (lock === 'manual') f.context.readVersion.current++; else f.context.paginationLock.current = true;
  pending.resolve({ phoneRequests: [{ id: 'old' }] }); await refresh; assert.equal(applied, false);
});

test('admin guest operations refresh the selected query and reject a concurrent decision', async () => {
  const pending = deferred(), calls = []; let result;
  const f = poll('app/admin/AdminGuestOperations.tsx', { active: true, venueId: 'club', saving: false, confirmation: null, loading: false, section: 'visits', filter: 'pending', offset: 25, period: 'tonight',
    inFlight: { current: false }, readVersion: { current: 0 }, requestAdminJson: (url, options) => { calls.push({ url, options }); return pending.promise; }, setData: value => { result = value; }, setError() {} });
  const refresh = f.run(); assert.match(calls[0].url, /venueId=club&section=visits&status=pending&offset=25&period=tonight/);
  f.context.readVersion.current++; pending.resolve({ venue: { id: 'club' }, section: 'visits', rows: [] }); await refresh; assert.equal(result, undefined);
  await f.run(); assert.equal(result.section, 'visits');
  const inactive = poll('app/admin/AdminGuestOperations.tsx', { ...f.context, confirmation: { id: 'editing' } }); assert.equal(inactive.options.active, false);
});

test('compliance queue updates other cases while retaining a draft and its original revision', async () => {
  const draft = { id: 'draft', workflow_revision: 1 }, other = { id: 'other', workflow_revision: 1 }; let data = { cases: [draft, other] };
  const f = poll('app/admin/AdminCompliance.tsx', { visible: true, busy: false, kind: 'staffing', page: 0, casePage: 0, caseStatus: 'open', refresh: 0, selected: 'draft', data,
    caseDraft: { current: true }, readVersion: { current: 1 }, requestAdminJson: async () => ({ cases: [{ id: 'draft', workflow_revision: 2 }, { id: 'other', workflow_revision: 2 }, { id: 'new' }] }), setData: apply => { data = apply(data); } });
  await f.run(); assert.equal(data.cases[0], draft); assert.equal(data.cases[1].workflow_revision, 2); assert.equal(data.cases[2].id, 'new');
  f.context.caseDraft.current = false; await f.run(); assert.equal(data.cases[0].workflow_revision, 2);
});

test('DMCA auto refresh preserves unsaved notes, contact settings and action receipts', async () => {
  let cases = [{ id: 'draft', updatedAt: 'original' }]; const pending = deferred();
  const f = poll('app/admin/AdminDmcaPanel.tsx', { active: true, actionInFlightRef: { current: false }, loadAbortRef: { current: null }, loadSequenceRef: { current: 0 }, actionSequenceRef: { current: 0 },
    reviewCaseIdRef: { current: '' }, draftNotesRef: { current: { draft: 'Keep notes' } }, requestAdminJson: () => pending.promise, setCases: apply => { cases = apply(cases); } });
  assert.equal(f.options.intervalMs, 60_000);
  const refresh = f.run(); pending.resolve({ cases: [{ id: 'draft', updatedAt: 'new' }, { id: 'arrival' }] }); await refresh;
  assert.equal(cases[0].updatedAt, 'original'); assert.equal(cases[1].id, 'arrival');
  const abandoned = f.run(); f.context.actionSequenceRef.current++; const original = cases; await abandoned; assert.equal(cases, original);
});

test('admin reports update the list while preserving notes typed during a request', async () => {
  const reports = [{ id: 'editing', reason: 'original' }], pending = deferred(); let updated;
  const f = poll('app/admin/AdminClient.tsx', { active: true, reports, actionInFlightRef: { current: false }, actionSequenceRef: { current: 0 }, draftNotesRef: { current: {} },
    requestAdminJson: () => pending.promise, onReportsChange: value => { updated = value; } }, 'function ReportManager(');
  const refresh = f.run(); f.context.draftNotesRef.current.editing = 'Unsaved'; pending.resolve({ reports: [{ id: 'new' }] }); await refresh;
  assert.equal(updated[0], reports[0]); assert.equal(updated[1].id, 'new');
});

test('application/social queue refresh keeps the selected draft and rejects a decision or edit made during the read', async () => {
  let args, selectedKey;
  const f = poll('app/admin/AdminClient.tsx', { active: true, busy: false, refreshing: false, filter: 'all', selected: { key: 'social:one', dancerId: 'one' },
    reviewVersion: { current: 2 }, draft: { current: true }, setSelectedKey: value => { selectedKey = value; }, onRefresh: async (...values) => { args = values; } }, 'function UnifiedReviewQueue(');
  await f.run(); assert.equal(selectedKey, 'social:one'); assert.equal(args[1], 'one'); assert.equal(args[2](), true);
  f.context.reviewVersion.current++; assert.equal(args[2](), false);
});
