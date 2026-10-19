import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
class PublicApiError extends Error { constructor(code, message, status) { super(message); Object.assign(this, { code, status }); } }
function compile(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, URL, URLSearchParams, AbortController, AbortSignal, console, ...globals,
    require: name => dependencies[name] ?? (['react', 'react/jsx-runtime'].includes(name) ? require(name) : {}) });
  return exports;
}
const types = compile('src/lib/dancr/admin-guest-operations-types.ts');
const vip = compile('src/lib/dancr/vip.ts', { '../api-error-policy': { PublicApiError } });
const service = compile('src/lib/dancr/admin-guest-operations.ts', {
  '../api-error-policy': { PublicApiError }, './vip': vip, './admin-guest-operations-types': types,
  './schedule': { getTonightWindow: (_timezone, now) => ({ startsAt: new Date(now.getTime() - 3600000).toISOString(), endsAt: new Date(now.getTime() + 3600000).toISOString() }) },
  './club-deal-transportation': { normalizeShuttleRequest: value => value?.phone ? value : null },
});
test('guest summary keeps failed counts unavailable and separates email from text opt-ins', async () => {
  const operations = compile('src/lib/dancr/admin-operations.ts', { '../security/safe-error-metadata': { safeErrorMetadata: () => ({}) } }, { console: { warn() {} } });
  const calls = [];
  const db = { from(table) {
    const filters = []; calls.push({ table, filters });
    const builder = new Proxy({}, { get(_target, key) {
      if (key === 'then') return done => Promise.resolve({ data: [], count: 3, error: table === 'club_shuttle_requests' ? new Error('Private detail') : null }).then(done);
      return (...args) => { filters.push([key, ...args]); return builder; };
    } }); return builder;
  } };
  const result = await operations.getAdminOperationsCenter(db);
  assert.deepEqual(plain(result.guests), { pendingVip: 3, activeVip: 3, guestList24h: 3, rides24h: null, emailUpdates: 3, textUpdates: 3 });
  for (const channel of ['email', 'text']) assert.ok(calls.some(call => call.table === 'venue_update_subscriptions'
    && call.filters.some(args => args[0] === 'eq' && args[1] === 'channel' && args[2] === channel)
    && call.filters.some(args => args[0] === 'is' && args[1] === 'withdrawn_at' && args[2] === null)));
  assert.equal(result.warnings.length, 1); assert.doesNotMatch(JSON.stringify(result.warnings), /Private detail/);
});
function database(rows, error = null) {
  const calls = [];
  const db = { from(table) {
    const call = { table, operations: [] }; calls.push(call);
    const builder = new Proxy({}, { get(_target, key) {
      if (key === 'then') return done => Promise.resolve(table === 'venues' ? { data: { id: id(10), name: 'Club', timezone: 'UTC', is_active: true } } : { data: rows, error, count: 5 }).then(done);
      return (...args) => { call.operations.push([key, ...args]); return builder; };
    } }); return builder;
  }, rpc: async (name, args) => { calls.push({ name, args }); return { data: { current: {}, performance: {} } }; } };
  return { db, calls };
}

test('guest list queries reject unknown sections, statuses, IDs and unbounded pages', () => {
  for (const args of ['venueId=bad', `venueId=${id(10)}&section=secrets`, `venueId=${id(10)}&offset=-1`, `venueId=${id(10)}&offset=100001`, `venueId=${id(10)}&section=updates&status=subscribe`, `venueId=${id(10)}&period=year`])
    assert.throws(() => service.adminGuestQuery(new URLSearchParams(args)));
});
test('admin command validation rejects opt-in creation, forged statuses and missing concurrency tokens', () => {
  for (const data of [{ action: 'subscribe' }, { action: 'request_status', status: 'confirmed' }, { action: 'unsubscribe' }, { action: 'set_nickname', nickname: 'Name' }, { action: 'invite', email: 'bad' }])
    assert.throws(() => service.adminGuestAction({ venueId: id(10), id: id(40), ...data }));
  const action = service.adminGuestAction({ venueId: id(10), id: id(40), action: 'unsubscribe', expectedConsentedAt: '2026-10-11T12:00:00Z', p_actor: id(99), manage_token: 'secret' });
  assert.equal(action.action, 'unsubscribe'); assert.doesNotMatch(JSON.stringify(action), /p_actor|manage_token|secret/);
});
for (const section of ['visits', 'members', 'invitations', 'guests', 'updates']) test(`${section} reads are club-scoped, bounded and omit credentials`, async () => {
  const f = database(Array.from({ length: 51 }, (_, n) => ({ id: id(n + 100), pass_id: id(n + 100), name: 'Guest', guest_name: 'Guest', display_name: 'Guest', active: true,
    created_at: '2026-10-11T12:00:00Z', consented_at: '2026-10-11T12:00:00Z', expires_at: '2099-01-01', channel: 'email', destination: 'guest@example.test',
    token_digest: 'secret', manage_token: 'secret', user_id: id(99), dancers: [{ stageName: 'Aria' }],
    qr_redemptions: { status: 'generated', expires_at: '2099-01-01', redemption_token: 'secret' } })));
  const result = await service.getAdminGuestOperations(f.db, new URLSearchParams({ venueId: id(10), section }));
  assert.equal(result.rows.length, 50); assert.equal(result.hasMore, true);
  assert.ok(f.calls[1].operations.some(args => args[0] === 'eq' && args[1] === 'venue_id' && args[2] === id(10)));
  assert.ok(f.calls[1].operations.some(args => args[0] === 'range' && args[1] === 0 && args[2] === 50));
  assert.doesNotMatch(JSON.stringify(result), /secret|manage_token|token_digest|user_id/);
  if (section === 'visits') assert.deepEqual(plain(result.rows[0].dancers), ['Aria']);
});
test('ride requests expose only the guest details in their matching receipt', async () => {
  const f = database([{ id: id(40), venue_id: id(10), created_at: '2026-10-11', handed_off_at: '2026-10-11', details_hash: 'secret',
    notification_rows: [{ recipient_id: id(99), payload: { kind: 'club_shuttle_request', requestId: id(40), venueId: id(10), name: 'Guest', phone: '+17025550123', location: 'Hotel', partySize: 2 } }] }]);
  const result = await service.getAdminGuestOperations(f.db, new URLSearchParams({ venueId: id(10), section: 'rides' }));
  assert.equal(result.rows[0].partySize, 2); assert.equal(result.rows[0].status, 'handed off');
  assert.doesNotMatch(JSON.stringify(result), /recipient_id|notification_rows|details_hash|secret/);
});
test('failed reads are errors rather than misleading empty lists', async () => {
  const f = database([], new Error('Unavailable'));
  await assert.rejects(() => service.getAdminGuestOperations(f.db, new URLSearchParams({ venueId: id(10) })), /Unavailable/);
});
test('admin results use the production performance aggregate and selected reporting period', async () => {
  const f = database([]);
  const result = await service.getAdminGuestOperations(f.db, new URLSearchParams({ venueId: id(10), section: 'results', period: '7d' }));
  assert.equal(result.results.totalFollowers, 5);
  const rpc = f.calls.find(call => call.name);
  assert.equal(rpc.name, 'get_venue_performance_analytics'); assert.equal(rpc.args.p_venue_id, id(10));
  assert.equal(Date.parse(rpc.args.p_until) - Date.parse(rpc.args.p_since), 7 * 86400000);
});

function routeFixture({ denied = false, deliveryFails = false, rpcError = null } = {}) {
  const calls = [];
  const admin = { rpc: async (name, args) => { calls.push({ name, args }); return { error: rpcError, data: { id: id(40), notifications: [{ recipient_id: id(3) }] } }; } };
  const route = compile('app/api/admin/guest-operations/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/src/lib/api': { PublicApiError, apiError: error => Response.json({ ok: false, error: error.message }, { status: error.status || 500 }) },
    '@/src/lib/dancr/admin': { requireAdmin: async () => { calls.push('verify'); if (denied) throw new PublicApiError('FORBIDDEN', 'Denied', 403); } },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ client: {}, user: { id: id(1) }, session: { accessToken: 'rotated' } }) },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => { calls.push('service'); return admin; } },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: async (request, options) => { assert.equal(options.maxBytes, 4096); return request.json(); } },
    '@/src/lib/dancr/admin-guest-operations': { ...service, getAdminGuestOperations: async () => ({ rows: [] }) },
    '@/src/lib/dancr/notification-delivery': { deliverNotificationRows: async () => { if (deliveryFails) throw new Error('Unavailable'); } },
  });
  return { route, calls };
}
test('both API methods deny non-admins before creating a privileged database client', async () => {
  for (const method of ['GET', 'POST']) {
    const f = routeFixture({ denied: true }); const response = await f.route[method](new Request('https://example.invalid/api/admin/guest-operations', { method }));
    assert.equal(response.status, 403); assert.deepEqual(f.calls, ['verify']);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
  }
});
test('admin writes use the verified actor, keep rotated sessions and never leak recipient rows', async () => {
  const f = routeFixture({ deliveryFails: true });
  const response = await f.route.POST(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ venueId: id(10), action: 'revoke_member', id: id(30), p_actor: id(99) }) }));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.session.accessToken, 'rotated');
  assert.equal(f.calls[2].args.p_actor, id(1)); assert.equal(f.calls[2].name, 'admin_guest_operation');
  assert.match(body.deliveryWarning, /Change saved/); assert.doesNotMatch(JSON.stringify(body), /recipient_id/);
});

test('stale admin records return a clear conflict without leaking database details', async () => {
  const f = routeFixture({ rpcError: { code: '40001', message: 'PRIVATE_DATABASE_DETAIL' } });
  const response = await f.route.POST(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ venueId: id(10), action: 'revoke_member', id: id(30) }) }));
  const body = await response.json();
  assert.equal(response.status, 409); assert.match(body.error, /record changed.*Refresh/);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_DATABASE_DETAIL/);
});

function panelFixture(request, initial = {}) {
  const slots = [], calls = [];
  let cursor = 0, effects = [], dirty = true, tree;
  const hooks = {
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j])))
      effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const Component = compile('app/admin/AdminGuestOperations.tsx', { react: hooks, 'next/dynamic': () => 'div',
    '@/src/lib/dancr/admin-guest-operations-types': types,
    '@/src/lib/dancr/club-deal-transportation': { clubArrivalLabel: value => value },
    './admin-session': { readAdminSession: () => ({ account: { id: id(1) } }), requestAdminJson: (url, options) => { calls.push({ url, options }); return request(url, options); } },
  }).default;
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 20; i++) { dirty = false; cursor = 0; effects = []; tree = Component({ venues: [{ id: id(10), name: 'Club A' }, { id: id(20), name: 'Club B' }], onActionConfirmed() {}, ...initial }); effects.forEach(fn => fn()); }
    assert.equal(dirty, false); return tree;
  }
  function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : []; }
  async function settle() { for (let i = 0; i < 10; i++) { await Promise.resolve(); render(); } }
  const choose = value => { nodes().find(node => node.type === 'select').props.onChange({ target: { value } }); render(); };
  const click = text => { const button = nodes().find(node => node.type === 'button' && node.props.children === text); assert.ok(button, text); button.props.onClick(); render(); };
  render();
  return { render, nodes, choose, click, settle, calls, unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
const visitData = (venueId = id(10)) => ({ venue: { id: venueId, name: 'Club', timezone: 'UTC', is_active: true }, section: 'visits', hasMore: false,
  rows: [{ id: id(40), name: 'Guest A', status: 'pending', createdAt: '2026-10-11T12:00:00Z', updatedAt: '2026-10-11T12:00:00Z', startsAt: '2026-10-12T19:00:00Z', dancers: ['Aria'] }] });

test('club shortcuts load the selected club and operation with pending work first', async () => {
  for (const [section, status] of [['visits', 'pending'], ['guests', 'generated'], ['rides', 'all'], ['results', 'all']]) {
    const ui = panelFixture(async () => ({ ...visitData(id(20)), section }), { initialVenueId: id(20), initialSection: section });
    await ui.settle();
    const url = new URL(ui.calls[0].url, 'https://example.test');
    assert.equal(url.searchParams.get('venueId'), id(20)); assert.equal(url.searchParams.get('section'), section); assert.equal(url.searchParams.get('status'), status);
    ui.unmount();
  }
});
test('admin panel waits for club selection, rejects late data from a previous club, and cancels reads on unmount', async () => {
  const pending = [];
  const ui = panelFixture(() => new Promise(resolve => pending.push(resolve)));
  assert.equal(ui.calls.length, 0);
  ui.choose(id(10)); ui.choose(id(20));
  assert.equal(ui.calls[0].options.signal.aborted, true);
  pending[0](visitData()); await ui.settle();
  assert.equal(ui.nodes().some(node => node.type === 'article'), false);
  pending[1](visitData(id(20))); await ui.settle();
  assert.equal(ui.nodes().filter(node => node.type === 'article').length, 1);
  ui.click('Refresh'); ui.unmount(); assert.equal(ui.calls.at(-1).options.signal.aborted, true);
});
test('admin decisions require review, submit once, and require refresh after a failed write', async () => {
  let rejectWrite;
  const ui = panelFixture((_url, options) => options.method === 'POST' ? new Promise((_resolve, reject) => { rejectWrite = reject; }) : Promise.resolve(visitData()));
  ui.choose(id(10)); await ui.settle(); ui.click('Confirm visit');
  assert.equal(ui.calls.filter(call => call.options.method === 'POST').length, 0);
  const form = ui.nodes().find(node => node.type === 'form' && node.props.className === 'admin-guest-confirm');
  form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); ui.render();
  assert.equal(ui.calls.filter(call => call.options.method === 'POST').length, 1);
  const body = JSON.parse(ui.calls.at(-1).options.body);
  assert.equal(body.expectedUpdatedAt, '2026-10-11T12:00:00Z'); assert.equal(body.venueId, id(10));
  rejectWrite(new Error('Request changed')); await ui.settle();
  assert.equal(ui.nodes().filter(node => node.type === 'article').length, 0);
  assert.ok(ui.nodes().some(node => node.props?.role === 'alert'));
  assert.equal(ui.nodes().find(node => node.type === 'button' && node.props.children === 'Refresh').props.disabled, false);
  ui.unmount();
});
