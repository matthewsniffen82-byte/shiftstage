import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const request = { id: 'club-a', name: 'Test club', city: 'Las Vegas', state: 'NV', page_review_status: 'changes_requested', page_review_notes: 'Please correct our opening hours.', page_reviewed_at: '2026-10-26T01:57:00Z' };

function endpoint({ allowed = true, failed = false, missingCount = false } = {}) {
  const rows = Array.from({ length: 22 }, (_, i) => ({ ...request, id: `club-${i}` }));
  rows.push({ ...request, id: 'published-club', page_review_status: 'published' });
  const calls = [], exports = {};
  const db = { from(table) {
    assert.equal(table, 'venues');
    const filters = []; let range;
    const query = { select(columns, options) { calls.push({ columns, options }); return query; },
      eq(key, value) { filters.push([key, value]); return query; }, order() { return query; },
      range(start, end) { range = [start, end]; return query; },
      then(resolve) { const matching = rows.filter(row => filters.every(([key, value]) => row[key] === value));
        return Promise.resolve({ data: matching.slice(range[0], range[1] + 1), count: missingCount ? null : matching.length, error: failed ? new Error('private database details') : null }).then(resolve); },
    }; return query;
  } };
  vm.runInNewContext(compile(source('app/api/admin/venue-change-requests/route.ts')), { exports, URL, Error, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } };
    if (name.endsWith('/api')) return { PublicApiError, apiError(error, fallback) { const response = resolveApiError(error, fallback); return Response.json(response.body, { status: response.status }); } };
    if (name.endsWith('dancr/admin')) return { async requireAdmin(_client, id) { assert.equal(id, 'admin'); if (!allowed) throw new PublicApiError('FORBIDDEN', 'Admin access required.', 403); } };
    if (name.endsWith('supabase/request')) return { async createRequestSupabaseContext() { return { client: {}, user: { id: 'admin' }, session: { accessToken: 'synthetic-refreshed-session' } }; } };
    if (name.endsWith('supabase/admin')) return { createAdminSupabaseClient: () => db };
    assert.fail(`Unexpected import ${name}`);
  } });
  return { calls, get: (page = '') => exports.GET(new Request('https://example.test/api/admin/venue-change-requests' + (page ? `?page=${page}` : ''))) };
}

test('the private queue returns saved change notes, exact totals and bounded pages', async () => {
  const f = endpoint(), response = await f.get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const body = await response.json();
  assert.equal(body.total, 22); assert.equal(body.requests.length, 20); assert.equal(body.hasMore, true);
  assert.equal(body.requests[0].page_review_notes, request.page_review_notes);
  assert.equal(body.session.accessToken, 'synthetic-refreshed-session');
  assert.equal(f.calls[0].options.count, 'exact');
  assert.doesNotMatch(f.calls[0].columns, /owner_user_id|email|phone/);
  const last = await (await f.get('1')).json();
  assert.equal(last.requests.length, 2); assert.equal(last.hasMore, false);
  assert.ok(last.requests.every(row => row.page_review_status === 'changes_requested'));
});

test('unauthorized users cannot read notes and invalid pages do not query the database', async () => {
  const denied = endpoint({ allowed: false });
  assert.equal((await denied.get()).status, 403); assert.equal(denied.calls.length, 0);
  for (const page of ['-1', 'NaN', '0.5', '10001']) {
    const f = endpoint(); assert.equal((await f.get(page)).status, 400); assert.equal(f.calls.length, 0);
  }
});

test('failed or unconfirmed reads never claim that there are no change requests', async () => {
  for (const options of [{ failed: true }, { missingCount: true }]) {
    const response = await endpoint(options).get();
    assert.equal(response.status, 500);
    const body = await response.json(); assert.equal(body.ok, false); assert.equal(body.total, undefined);
    assert.doesNotMatch(body.error, /private database details/);
  }
});

const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));
function component() {
  const slots = [], effects = [], pending = [], counts = [], opened = [], listeners = new Map();
  let cursor = 0, tree, interval;
  const add = (event, listener) => listeners.set(event, listener);
  const remove = (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); };
  const document = { visibilityState: 'visible', addEventListener: add, removeEventListener: remove };
  const window = { setInterval(callback) { interval = callback; return 1; }, clearInterval() { interval = null; }, addEventListener: add, removeEventListener: remove };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) { old?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = effect(); }); } },
  };
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compile(source('app/admin/AdminClubChangeRequests.tsx')), { exports, window, document, AbortController, Error, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './admin-session') return { requestAdminJson: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })) };
    if (name === './admin-data-events') return { ADMIN_DATA_CHANGED: 'changed' };
    if (name.endsWith('.css')) return { default: { queue: 'queue' } };
    assert.fail(`Unexpected import ${name}`);
  } });
  const props = { visible: true, onOpen: value => opened.push(value), onCountChange: value => counts.push(value) };
  function render() { cursor = 0; tree = exports.default(props); while (effects.length) effects.shift()(); return nodes(tree); }
  const all = () => nodes(tree);
  render();
  return { pending, counts, opened, props, document, render, all,
    event(name) { return listeners.get(name)?.(); }, tick() { return interval?.(); },
    async complete(index, data = { requests: [request], total: 1, hasMore: false }) { pending[index].resolve(data); await settle(); render(); },
    async fail(index) { pending[index].reject(new Error('Refresh unavailable')); await settle(); render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('the queue displays the saved note and opens its club without writing or sending a message', async () => {
  const f = component(); await f.complete(0);
  assert.ok(f.all().some(node => node.type === 'p' && node.props.children === request.page_review_notes));
  f.all().find(node => node.type === 'button' && node.props.children === 'Review changes').props.onClick();
  assert.equal(f.opened[0].id, request.id); assert.deepEqual(f.counts, [1]);
  assert.ok(f.pending.every(call => !call.options.method)); f.close();
});

test('returning to the tab and completed admin actions refresh the queue and badge', async () => {
  const f = component(); await f.complete(0);
  f.document.visibilityState = 'hidden'; f.tick(); assert.equal(f.pending.length, 1);
  f.document.visibilityState = 'visible'; f.event('visibilitychange');
  await f.complete(1, { requests: [], total: 0, hasMore: false });
  assert.deepEqual(f.counts, [1, 0]); assert.equal(f.all().filter(node => node.type === 'article').length, 0);
  f.event('changed'); await f.complete(2); assert.equal(f.counts.at(-1), 1); f.close();
});

test('failed refresh keeps the last confirmed note and marks the badge count unavailable', async () => {
  const f = component(); await f.complete(0); f.event('changed'); await f.fail(1);
  assert.equal(f.counts.at(-1), null);
  assert.ok(f.all().some(node => node.props?.role === 'alert'));
  assert.ok(f.all().some(node => node.type === 'p' && node.props.children === request.page_review_notes)); f.close();
});

test('pagination cancels old loads and late responses cannot overwrite a newer page or signed-out state', async () => {
  const f = component(); await f.complete(0, { requests: [request], total: 21, hasMore: true });
  f.tick();
  f.all().find(node => node.type === 'button' && node.props.children === 'Next').props.onClick(); f.render();
  assert.equal(f.pending[1].options.signal.aborted, true);
  assert.match(f.pending[2].url, /page=1/);
  await f.complete(2, { requests: [{ ...request, id: 'next', name: 'Next club' }], total: 21, hasMore: false });
  await f.complete(1);
  assert.ok(f.all().some(node => node.type === 'strong' && node.props.children === 'Next club'));
  f.event('changed'); const count = f.counts.length; f.close(); await f.complete(3);
  assert.equal(f.counts.length, count); assert.equal(f.pending[3].options.signal.aborted, true);
});

test('opening a queued request refreshes review metadata without overwriting unsaved venue fields', () => {
  const code = source('app/admin/AdminClient.tsx'), ast = ts.createSourceFile('client.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn; const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openClubChangeRequest') fn = node; ts.forEachChild(node, visit); }; visit(ast);
  for (const loaded of [true, false]) {
    const state = { venues: loaded ? [{ id: request.id, name: 'Name already being edited', page_review_status: 'venue_review' }] : [] };
    const completedWorkspaces = { current: { clubs: true } }, opened = [], selected = [], exports = {};
    class Details { open = false; scrollIntoView() {} } const row = new Details();
    vm.runInNewContext(compile(fn.getText(ast) + '\nexport {openClubChangeRequest};'), {
      exports, state, completedWorkspaces, asText: String, setState: update => Object.assign(state, update(state)),
      setRequestedClubId: value => selected.push(value), openWorkspace: (...args) => opened.push(args),
      window: { requestAnimationFrame: callback => callback() }, document: { getElementById: () => row }, HTMLDetailsElement: Details,
    });
    exports.openClubChangeRequest(request);
    assert.deepEqual(opened[0], ['clubs', 'admin-club-club-a']); assert.deepEqual(selected, ['club-a']); assert.equal(row.open, true);
    if (loaded) { assert.equal(state.venues[0].name, 'Name already being edited'); assert.equal(state.venues[0].page_review_notes, request.page_review_notes); }
    else assert.equal(completedWorkspaces.current.clubs, false);
  }
});
