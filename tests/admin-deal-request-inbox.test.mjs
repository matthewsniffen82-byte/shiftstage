import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const request = { id: 'request-a', venue_id: 'club-a', request_type: 'add', offer_title: 'Free admission', request_notes: 'Please review this deal.', status: 'pending', created_at: '2026-10-26T01:57:00Z', venues: { name: 'Test club', city: 'Las Vegas', state: 'NV' } };

test('deal inbox includes pending and under-review requests, with exact counts and bounded pages', async () => {
  const f = endpoint(), response = await f.get();
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  const body = await response.json();
  assert.equal(body.total, 22); assert.equal(body.requests.length, 20); assert.equal(body.hasMore, true);
  assert.equal(body.requests[0].request_notes, request.request_notes);
  assert.equal(body.session.accessToken, 'synthetic-refreshed-session');
  assert.equal(f.calls[0].options.count, 'exact');
  const last = await (await f.get('1')).json();
  assert.equal(last.requests.length, 2); assert.equal(last.hasMore, false);
  assert.equal(last.requests[1].status, 'under_review');
  assert.ok([...body.requests, ...last.requests].every(row => ['pending', 'under_review'].includes(row.status)));
});

test('deal notes require admin access and invalid pages never reach the database', async () => {
  const denied = endpoint({ allowed: false }); assert.equal((await denied.get()).status, 403); assert.equal(denied.calls.length, 0);
  for (const page of ['-1', 'NaN', '0.5', '10001']) {
    const f = endpoint(); assert.equal((await f.get(page)).status, 400); assert.equal(f.calls.length, 0);
  }
  for (const options of [{ failed: true }, { missingCount: true }]) {
    const response = await endpoint(options).get(); assert.equal(response.status, 500);
    const body = await response.json(); assert.equal(body.total, undefined); assert.doesNotMatch(body.error, /private database details/);
  }
});

test('deal inbox displays saved notes and opens the exact request without modifying it', async () => {
  const f = component(); await f.complete(0);
  assert.ok(f.all().some(node => node.type === 'p' && node.props.children === request.request_notes));
  f.all().find(node => node.type === 'button' && node.props.children === 'Review request').props.onClick();
  assert.equal(f.opened[0].id, request.id); assert.equal(f.opened[0].venue_id, request.venue_id);
  assert.deepEqual(f.counts, [1]); assert.ok(f.pending.every(call => !call.options.method)); f.close();
});

test('deal refresh preserves cards while loading and on failure, then removes resolved requests', async () => {
  const f = component(); await f.complete(0); f.tick(); f.render();
  assert.equal(f.all().filter(node => node.type === 'article').length, 1);
  await f.fail(1); assert.equal(f.counts.at(-1), null);
  assert.equal(f.all().filter(node => node.type === 'article').length, 1);
  f.event('changed'); await f.complete(2, { requests: [], total: 0, hasMore: false });
  assert.equal(f.counts.at(-1), 0); assert.equal(f.all().filter(node => node.type === 'article').length, 0); f.close();
});

test('deal queue ignores hidden-tab polls and late responses after pagination or sign-out', async () => {
  const f = component(); await f.complete(0, { requests: [request], total: 21, hasMore: true });
  f.document.visibilityState = 'hidden'; f.tick(); assert.equal(f.pending.length, 1);
  f.document.visibilityState = 'visible'; f.event('visibilitychange');
  f.all().find(node => node.type === 'button' && node.props.children === 'Next').props.onClick(); f.render();
  assert.equal(f.pending[1].options.signal.aborted, true); assert.match(f.pending[2].url, /page=1/);
  await f.complete(2, { requests: [{ ...request, id: 'next', request_notes: 'Next page' }], total: 21, hasMore: false });
  await f.complete(1); assert.ok(f.all().some(node => node.type === 'p' && node.props.children === 'Next page'));
  f.event('changed'); const count = f.counts.length; f.close(); await f.complete(3); assert.equal(f.counts.length, count);
});

test('reviewing a queued deal loads current club requests before opening the exact request and preserves drafts', async () => {
  const code = source('app/admin/AdminClient.tsx'), ast = ts.createSourceFile('client.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn; const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'openClubDealRequest') fn = node; ts.forEachChild(node, visit); }; visit(ast);
  const state = { venues: [{ id: request.venue_id, name: 'Unsaved club name' }], dealRequests: [{ id: 'other', venueId: 'another-club' }] };
  const calls = [], opened = [], targets = [], errors = [], exports = {}, mountedRef = { current: true };
  vm.runInNewContext(compile(fn.getText(ast) + '\nexport {openClubDealRequest};'), {
    exports, state, mountedRef, dealOpenSequenceRef: { current: 0 }, completedWorkspaces: { current: { clubs: true } },
    readBrowserAccountIdentity: () => 'admin', setDealOpenError: error => errors.push(error),
    requestAdminJson: async (url, options) => { calls.push({ url, options }); return { dealRequests: [{ id: request.id, venueId: request.venue_id, offerTitle: 'Free admission' }], clubDeals: [] }; },
    loadWorkspaceData: async () => { state.dealRequests = []; }, setState: update => Object.assign(state, update(state)), asText: String,
    setRequestedClubId: () => {}, setRequestedDealTarget: update => targets.push(update(null)), openWorkspace: (...args) => opened.push(args),
  });
  await exports.openClubDealRequest(request);
  assert.match(calls[0].url, /venueId=club-a/); assert.equal(calls[0].options.method, undefined);
  assert.equal(state.venues[0].name, 'Unsaved club name'); assert.equal(state.dealRequests[0].id, request.id);
  assert.deepEqual(opened[0], ['clubs', 'admin-club-club-a']); assert.equal(targets[0].id, request.id); assert.equal(errors.at(-1), '');
  mountedRef.current = false; await exports.openClubDealRequest(request); assert.equal(opened.length, 1);
  const targetsInUi = [];
  const findTargets = node => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.attributes.properties.some(prop => prop.name?.text === 'requestedDealTarget')) targetsInUi.push(node.tagName.getText(ast));
    ts.forEachChild(node, findTargets);
  };
  findTargets(ast); assert.deepEqual(targetsInUi, ['VenueManager']);
});

test('the review destination opens enclosing panels and focuses the exact deal without resetting form values', () => {
  const code = source('app/admin/AdminClient.tsx'), ast = ts.createSourceFile('client.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const manager = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'VenueManager');
  const effect = manager.body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).startsWith('useEffect') && node.getText(ast).includes('revealedDealRevision.current'));
  class Details { open = false; parentElement = null; }
  const club = new Details(), panel = new Details(); panel.parentElement = club;
  const focused = [], scrolled = [], exports = {}, revealedDealRevision = { current: 0 };
  const target = { parentElement: panel, draftValue: 'Keep this draft', focus: options => focused.push(options), scrollIntoView: options => scrolled.push(options) };
  vm.runInNewContext(compile('export function run() {' + effect.getText(ast) + '}'), {
    exports, requestedDealTarget: { id: request.id, venueId: request.venue_id, revision: 1 }, openedVenues: { [request.venue_id]: true }, dealRequests: [], revealedDealRevision,
    useEffect: callback => callback(), HTMLDetailsElement: Details,
    window: { requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {} },
    document: { getElementById(id) { assert.equal(id, 'admin-deal-request-' + request.id); return target; } },
  });
  exports.run(); assert.equal(club.open, true); assert.equal(panel.open, true); assert.equal(focused.length, 1);
  assert.equal(scrolled[0].block, 'center'); assert.equal(target.draftValue, 'Keep this draft');
  exports.run(); assert.equal(focused.length, 1, 'a background refresh must not move focus again');
});

function endpoint({ allowed = true, failed = false, missingCount = false } = {}) {
  const rows = Array.from({ length: 22 }, (_, i) => ({ ...request, id: `club-${i}` }));
  rows[21].status = 'under_review'; rows.push({ ...request, id: 'approved', status: 'approved' });
  const calls = [], exports = {};
  const db = { from(table) {
    assert.equal(table, 'venue_club_deal_requests');
    const filters = []; let range;
    const query = { select(columns, options) { calls.push({ columns, options }); return query; },
      in(key, value) { filters.push([key, value]); return query; }, order() { return query; },
      range(start, end) { range = [start, end]; return query; },
      then(resolve) { const matching = rows.filter(row => filters.every(([key, value]) => value.includes(row[key])));
        return Promise.resolve({ data: matching.slice(range[0], range[1] + 1), count: missingCount ? null : matching.length, error: failed ? new Error('private database details') : null }).then(resolve); },
    }; return query;
  } };
  vm.runInNewContext(compile(source('app/api/admin/deal-requests/route.ts')), { exports, URL, Error, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } };
    if (name.endsWith('/api')) return { PublicApiError, apiError(error, fallback) { const response = resolveApiError(error, fallback); return Response.json(response.body, { status: response.status }); } };
    if (name.endsWith('dancr/admin')) return { async requireAdmin(_client, id) { assert.equal(id, 'admin'); if (!allowed) throw new PublicApiError('FORBIDDEN', 'Admin access required.', 403); } };
    if (name.endsWith('supabase/request')) return { async createRequestSupabaseContext() { return { client: {}, user: { id: 'admin' }, session: { accessToken: 'synthetic-refreshed-session' } }; } };
    if (name.endsWith('supabase/admin')) return { createAdminSupabaseClient: () => db };
    assert.fail(`Unexpected import ${name}`);
  } });
  return { calls, get: (page = '') => exports.GET(new Request('https://example.test/api/admin/deal-requests' + (page ? `?page=${page}` : ''))) };
}

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
  vm.runInNewContext(compile(source('app/admin/AdminClubDealRequests.tsx')), { exports, window, document, AbortController, Error, require(name) {
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
