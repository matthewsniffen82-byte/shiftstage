import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const requestId = '22222222-2222-4222-8222-222222222222';
class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function compile(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, URLSearchParams, Date, Error, Request, Response, AbortController, console: { warn() {} },
    require: name => name in deps ? deps[name] : ['node:crypto', 'next/server', 'react/jsx-runtime'].includes(name) ? require(name) : {}, ...globals });
  return exports;
}
function serviceFixture(options = {}) {
  const operations = [], events = [];
  const rows = [{ id: requestId, venue_name: 'Spearmint Rhino', city: 'Las Vegas', state: 'NV', status: 'approved',
    contact_name: 'Manager', login_email: 'club@example.test', requester_user_id: 'manager', matched_venue_id: 'venue',
    submitted_at: '2026-01-01T00:00:00Z', reviewed_at: '2026-01-02T00:00:00Z', review_notes: 'Verified business', reviewer: { display_name: 'Site owner' } }];
  const admin = { from(table) {
    let updated, filters = [];
    const q = {
      select(...args) { operations.push([table, 'select', ...args]); return q; },
      in(key, values) { filters.push([key, values]); operations.push([table, 'in', key, values]); return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      ilike(key, value) { operations.push([table, 'ilike', key, value]); return q; },
      order(key, options) { operations.push([table, 'order', key, options]); return q; },
      range: async (from, to) => { operations.push([table, 'range', from, to]); return { data: rows, count: 51, error: null }; },
      limit: async () => ({ data: events, error: null }),
      insert: async event => { if (options.startError) return { error: new Error('audit unavailable') }; events.push({ ...event, created_at: '2026-10-25T00:00:00Z', actor: { display_name: 'Site owner' } }); return {}; },
      update(value) { updated = value; return q; },
      single: async () => { if (options.recordError) return { error: new Error('audit unavailable') }; const row = events.find(e => e.id === filters.find(([key]) => key === 'id')[1]); Object.assign(row, updated); return { data: { id: row.id } }; },
    }; return q;
  } };
  let sends = 0;
  const service = compile('src/lib/dancr/admin-club-approvals.ts', {
    '../api-error-policy': { PublicApiError }, '../security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
    './venue-signup-requests': { resendVenueAccountApproval: async (_admin, id) => { sends++; assert.equal(id, requestId); if (options.sendError) throw new PublicApiError('FORBIDDEN','Inactive club',403); return { delivered: !options.failed, recipient: 'club@example.test', ...(options.uncertain ? { reason: 'provider_unavailable' } : {}) }; } },
  });
  return { service, admin, rows, events, operations, get sends() { return sends; } };
}

test('approval history preserves prior decisions, reviewer identity and review notes with pagination', async () => {
  const f = serviceFixture();
  const result = await f.service.getClubApprovalHistory(f.admin, { status: 'all', page: 1, search: 'Rhino%_' });
  assert.equal(result.total, 51); assert.equal(result.hasMore, true); assert.equal(result.requests[0].reviewedBy, 'Site owner');
  assert.equal(result.requests[0].reviewNotes, 'Verified business'); assert.equal(result.requests[0].canResend, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.operations.find(o => o[1] === 'in'))), ['venue_signup_requests', 'in', 'status', ['approved','rejected']]);
  assert.deepEqual(f.operations.find(o => o[1] === 'range'), ['venue_signup_requests','range',25,49]);
  assert.equal(f.operations.find(o => o[1] === 'ilike')[3], '%Rhino\\%\\_%');
});
test('history filters reject unsupported status, negative pages and oversized searches', () => {
  const f = serviceFixture();
  for (const query of ['status=pending','page=-1','page=1.5','page=10001','search=' + 'a'.repeat(161)]) assert.throws(() => f.service.clubApprovalHistoryQuery(new URL('https://example.test/?' + query)), { status: 400 });
});
test('resend audit records the acting admin and exposes no private sign-in link', async () => {
  const f = serviceFixture(); const result = await f.service.resendClubApproval(f.admin, requestId, 'admin-one');
  assert.equal(result.delivered, true); assert.equal(result.historyRecorded, true); assert.equal(f.sends, 1);
  assert.equal(f.events[0].admin_id, 'admin-one'); assert.equal(f.events[0].action, 'club_dashboard_link_resent');
  assert.doesNotMatch(JSON.stringify(f.events), /token|#link|vca_/);
  const history = await f.service.getClubApprovalHistory(f.admin, { status: 'approved', page: 0, search: '' });
  assert.equal(history.requests[0].resends[0].status, 'sent'); assert.equal(history.requests[0].resends[0].by, 'Site owner');
});
test('resend failure and uncertain delivery are recorded without a false success', async () => {
  for (const uncertain of [false, true]) {
    const f = serviceFixture({ failed: true, uncertain }); const result = await f.service.resendClubApproval(f.admin, requestId, 'admin-one');
    assert.equal(result.delivered, false); assert.equal(result.deliveryUncertain, uncertain);
    assert.equal(f.events[0].action, uncertain ? 'club_dashboard_link_resend_requested' : 'club_dashboard_link_resend_failed');
  }
  const f = serviceFixture({ sendError: true }); await assert.rejects(f.service.resendClubApproval(f.admin, requestId, 'admin-one'), { status: 403 });
  assert.equal(f.events[0].action, 'club_dashboard_link_resend_failed');
});
test('audit outages stop unrecorded sends and never claim a sent email failed', async () => {
  const before = serviceFixture({ startError: true }); await assert.rejects(before.service.resendClubApproval(before.admin, requestId, 'admin-one')); assert.equal(before.sends, 0);
  const after = serviceFixture({ recordError: true }); const result = await after.service.resendClubApproval(after.admin, requestId, 'admin-one');
  assert.equal(result.delivered, true); assert.equal(result.historyRecorded, false); assert.equal(after.events[0].action, 'club_dashboard_link_resend_requested');
});

function routeFixture(options = {}) {
  const calls = []; class RateError extends Error { retryAfterSeconds = 60; }
  const route = compile('app/api/admin/club-approvals/route.ts', {
    '@/src/lib/api': { PublicApiError, apiError: error => new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: request => request.json() },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => { calls.push('auth'); if (options.signedOut) throw new PublicApiError('UNAUTHORIZED','Sign in',401); return { client: 'client', user: { id: 'owner' }, session: { accessToken: 'refreshed' } }; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => 'admin' },
    '@/src/lib/dancr/admin': { requireAdmin: async () => { calls.push('owner'); if (options.denied) throw new PublicApiError('FORBIDDEN','Not permitted',403); } },
    '@/src/lib/dancr/venue-signup-requests': { VenueSignupRequestUserError: class extends Error {} },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError: RateError, enforcePublicRequestRateLimit: async (_admin, value) => { calls.push('limit'); assert.equal(value.subject, requestId); if (options.limited) throw new RateError(); } },
    '@/src/lib/dancr/admin-club-approvals': { clubApprovalHistoryQuery: () => ({}), getClubApprovalHistory: async () => { calls.push('history'); return { requests: [] }; },
      resendClubApproval: async (...args) => { calls.push(args); return { delivered: true, recipient: 'saved@example.test', historyRecorded: true }; } },
  });
  const send = body => route.POST(new Request('https://example.test/api/admin/club-approvals', { method: 'POST', body: JSON.stringify(body || { action: 'resend', requestId, email: 'injected@example.test' }) }));
  return { route, calls, send };
}
test('only authorized site admins can see history or resend club links', async () => {
  for (const options of [{ signedOut: true }, { denied: true }]) {
    const f = routeFixture(options); const status = options.signedOut ? 401 : 403;
    assert.equal((await f.route.GET(new Request('https://example.test/api/admin/club-approvals'))).status, status);
    assert.equal((await f.send()).status, status); assert.ok(!f.calls.includes('history')); assert.ok(!f.calls.some(Array.isArray));
  }
});
test('resend uses saved club recipient, refreshed admin sessions and server rate limits', async () => {
  const f = routeFixture(); const response = await f.send(); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.recipient, 'saved@example.test'); assert.equal(data.session.accessToken, 'refreshed');
  assert.deepEqual(f.calls.at(-1), ['admin',requestId,'owner']); assert.match(response.headers.get('cache-control'), /no-store/);
  const limited = routeFixture({ limited: true }); const blocked = await limited.send(); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60'); assert.ok(!limited.calls.some(Array.isArray));
  const bad = routeFixture(); assert.equal((await bad.send({ action: 'approve', requestId })).status, 400); assert.ok(!bad.calls.some(Array.isArray));
});

test('resending an approved request reuses its account and never repeats the approval mutation', async () => {
  const deliveries = [], links = [];
  const service = compile('src/lib/dancr/venue-signup-requests.ts', {
    './admin-venue-registration': { mapApprovedVenue: row => row },
    './venue-approval-link': { createVenueApprovalLink: async (_admin, input) => { links.push(input); return 'https://example.test/auth/venue-approval#link=private-proof'; } },
    './notification-delivery': { sendTransactionalEmail: async message => { deliveries.push(message); return { delivered: true }; } },
  });
  const row = { id: requestId, status: 'approved', login_email: 'club@example.test', requester_user_id: 'manager', matched_venue_id: 'venue', contact_name: 'Manager' };
  const admin = { from(table) { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'venues' ? { id: 'venue', name: 'Club' } : row }) }; return q; }, rpc: () => { throw new Error('must not reapprove'); } };
  const result = await service.resendVenueAccountApproval(admin, requestId);
  assert.equal(result.delivered, true); assert.equal(deliveries[0].to, 'club@example.test'); assert.equal(links[0].reissue, true);
  row.status = 'pending'; await assert.rejects(service.resendVenueAccountApproval(admin, requestId), /Only approved/); assert.equal(deliveries.length, 1);
  row.status = 'approved'; row.requester_user_id = null; await assert.rejects(service.resendVenueAccountApproval(admin, requestId), /older approval/); assert.equal(deliveries.length, 1);
});

const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join(' ') : '';
const find = (node, predicate) => { if (!node || typeof node !== 'object') return null; if (predicate(node)) return node; for (const child of [node.props?.children].flat(Infinity)) { const result = find(child,predicate); if (result) return result; } return null; };
async function componentFixture() {
  const slots = [], effects = [], calls = [], listeners = new Map(), notices = [];
  let index = 0, resolveSend, accountId = 'owner';
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
    useEffect(effect,deps) { const i = index++, previous = slots[i]; if (!previous || deps.some((v,j) => v !== previous.deps[j])) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const row = { id: requestId, venueName: 'Spearmint Rhino', status: 'approved', reviewedAt: '2026-01-02', submittedAt: '2026-01-01', reviewedBy: 'Site owner', reviewNotes: 'Verified business', loginEmail: 'club@example.test', canResend: true, resends: [] };
  const component = compile('app/admin/AdminClubApprovalHistory.tsx', {
    react, './admin-data-events': { ADMIN_DATA_CHANGED: 'changed' }, './club-approval-history.module.css': { default: {} },
    './admin-session': { readAdminSession: () => ({ account: { id: accountId } }), requestAdminJson: async (url, init) => { calls.push([url, init]); if (init.method === 'POST') return new Promise(resolve => { resolveSend = resolve; }); return { requests: [row], total: 1, hasMore: false }; } },
  }, { window: { addEventListener: (name, fn) => listeners.set(name,fn), removeEventListener: name => listeners.delete(name) } }).default;
  const render = () => { index = 0; const tree = component({ onActionConfirmed: message => notices.push(message) }); while(effects.length) effects.shift()(); return tree; };
  render(); await new Promise(resolve => setImmediate(resolve));
  return { render, calls, notices, listeners, resolveSend: data => resolveSend(data), switchAccount: () => { accountId = 'someone-else'; }, unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
test('history displays saved approval details and blocks duplicate resend clicks', async () => {
  const f = await componentFixture(); assert.match(text(f.render()), /Verified business/); assert.match(text(f.render()), /Site owner/);
  const resend = find(f.render(), node => node.type === 'button' && text(node) === 'Resend dashboard link');
  resend.props.onClick(); resend.props.onClick(); assert.equal(f.calls.filter(([, init]) => init.method === 'POST').length, 1);
  f.resolveSend({ delivered: true, message: 'Dashboard link sent to club@example.test.' }); await new Promise(resolve => setImmediate(resolve));
  assert.match(text(f.render()), /Dashboard link sent to club@example.test/); assert.equal(f.notices.length, 1); f.unmount();
});
test('a late resend result cannot update another admin session', async () => {
  const f = await componentFixture(); find(f.render(), node => node.type === 'button' && text(node) === 'Resend dashboard link').props.onClick();
  f.switchAccount(); f.resolveSend({ delivered: true, message: 'Old account result' }); await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(text(f.render()), /Old account result/); assert.equal(f.notices.length, 0); f.unmount();
});
