import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const roles = ['customer', 'dancer', 'venue'];
const policy = {};
vm.runInNewContext(compile('src/lib/dancr/support-unread.ts'), { exports: policy, Date, require: name => name.endsWith('/api') ? { PublicApiError } : { SUPPORT_USER_ROLES: roles } });
const id = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// In-memory PostgREST boundary: exercise both queries against multiple recipients,
// including archived conversations, outgoing replies, bots and later arrivals.
function database() {
  const rows = [
    { id: id(1), sender_role: 'admin', owner: 'guest', role: 'customer' },
    { id: id(2), sender_role: 'admin', owner: 'other', role: 'venue' },
    { id: id(3), sender_role: 'customer', owner: 'guest', role: 'customer' },
    { id: id(4), sender_role: 'venue', owner: 'other', role: 'venue', archived: 'yesterday' },
    { id: id(5), sender_role: 'admin', owner: 'guest', role: 'customer', sender_kind: 'ai' },
    { id: id(6), sender_role: 'admin', owner: 'guest', role: 'customer', read_at: 'yesterday' },
    { id: id(7), sender_role: 'dancer', owner: 'dancer', role: 'dancer', sender_kind: 'system' },
    { id: id(8), sender_role: 'admin', owner: 'guest', role: 'customer', archived: 'yesterday' },
  ].map(row => ({ read_at: null, sender_kind: 'human', archived: null, ...row }));
  const calls = [];
  const value = (row, key) => key === 'support_threads.user_id' ? row.owner : key === 'support_threads.user_role' ? row.role : key === 'support_threads.admin_archived_at' ? row.archived : row[key];
  return { rows, calls, from(table) {
    assert.equal(table, 'support_messages');
    const filters = []; let count = false, update;
    const q = {
      select(columns, options) { calls.push(['select', columns, options]); count = options?.count === 'exact'; return q; },
      is(key, target) { filters.push(row => value(row, key) === target); return q; },
      eq(key, target) { filters.push(row => value(row, key) === target); return q; },
      in(key, targets) { filters.push(row => targets.includes(value(row, key))); return q; },
      or(expression) { assert.equal(expression, 'sender_kind.is.null,sender_kind.eq.human'); filters.push(row => row.sender_kind == null || row.sender_kind === 'human'); return q; },
      update(values) { update = values; return q; },
      then(resolve) {
        const selected = rows.filter(row => filters.every(filter => filter(row)));
        if (update) selected.forEach(row => Object.assign(row, update));
        resolve({ data: count ? null : selected.map(row => ({ id: row.id })), count: count ? selected.length : null, error: null });
      },
    }; return q;
  } };
}

test('unread counts include only incoming human messages for the correct recipient', async () => {
  const db = database();
  assert.equal(await policy.countUnreadSupportMessages(db, { userId: 'guest', admin: false }), 2);
  assert.equal(await policy.countUnreadSupportMessages(db, { userId: 'other', admin: false }), 1);
  assert.equal(await policy.countUnreadSupportMessages(db, { userId: 'admin', admin: true }), 1);
  assert.equal(db.calls[0][2].head, true, 'badge requests must not retrieve message bodies');
});

test('read receipts cannot clear another account, outgoing messages, or later unseen replies', async () => {
  const db = database();
  const changed = await policy.markSupportMessagesRead(db, { userId: 'guest', admin: false }, [id(1), id(2), id(3), id(5)]);
  assert.deepEqual(Array.from(changed), [id(1)]);
  assert.equal(db.rows.find(row => row.id === id(2)).read_at, null);
  assert.equal(db.rows.find(row => row.id === id(3)).read_at, null);
  assert.equal(db.rows.find(row => row.id === id(8)).read_at, null, 'unseen replies in the same account stay unread');
  assert.equal(await policy.countUnreadSupportMessages(db, { userId: 'guest', admin: false }), 1);
  assert.deepEqual(Array.from(await policy.markSupportMessagesRead(db, { userId: 'guest', admin: false }, [id(1)])), []);
});

test('admin receipts skip archived threads and admin-authored messages', async () => {
  const db = database();
  assert.deepEqual(Array.from(await policy.markSupportMessagesRead(db, { userId: 'admin', admin: true }, db.rows.map(row => row.id))), [id(3)]);
  assert.equal(db.rows.find(row => row.id === id(4)).read_at, null);
  assert.equal(db.rows.find(row => row.id === id(1)).read_at, null);
});

test('read receipts require bounded explicit message IDs', () => {
  assert.deepEqual(Array.from(policy.parseReadMessageIds([id(1), id(1)])), [id(1)]);
  for (const invalid of [null, [], ['invalid'], [1], Array(101).fill(id(1))]) assert.throws(() => policy.parseReadMessageIds(invalid), PublicApiError);
});

function endpoint(role = 'customer', scope = 'owner', authenticated = true) {
  const exports = {}, db = database(); let serviceCalls = 0;
  vm.runInNewContext(compile('app/api/support/unread/route.ts'), { exports, Error, require(name) {
    if (name === 'next/server') return { NextResponse: { json: Response.json } };
    if (name.endsWith('/api')) return { PublicApiError, apiError(error, fallback) { const result = resolveApiError(error, fallback); return Response.json(result.body, { status: result.status }); } };
    if (name.endsWith('/bounded-json-body')) return { readBoundedJsonObject: request => request.json() };
    if (name.endsWith('/support-unread')) return policy;
    if (name.endsWith('dancr/support')) return { isSupportUserRole: value => roles.includes(value) };
    if (name.endsWith('dancr/admin')) return { async requireAdmin(_client, actor, required) { assert.equal(actor, 'guest'); assert.equal(required, 'support'); if (!['owner', 'support'].includes(scope)) throw new PublicApiError('FORBIDDEN', 'Denied', 403); } };
    if (name.endsWith('supabase/request')) return { async createRequestSupabaseContext() {
      if (!authenticated) throw new PublicApiError('AUTH_REQUIRED', 'Sign in required.', 401);
      const chain = { select() { return chain; }, eq(column, value) { assert.equal(column, 'id'); assert.equal(value, 'guest'); return chain; }, maybeSingle: async () => ({ data: { role }, error: null }) };
      return { client: { from: () => chain }, user: { id: 'guest' }, session: { accessToken: 'refreshed' } };
    } };
    if (name.endsWith('supabase/admin')) return { createAdminSupabaseClient() { serviceCalls++; return db; } };
    assert.fail(name);
  } });
  return { db, get: () => exports.GET(new Request('https://example.test/api/support/unread?userId=other&admin=true')),
    patch: (messageIds = [id(1)]) => exports.PATCH(new Request('https://example.test/api/support/unread', { method: 'PATCH', body: JSON.stringify({ messageIds, userId: 'other', admin: true }) })), serviceCalls: () => serviceCalls };
}

test('API authorizes roles before service access and ignores forged recipient/admin fields', async () => {
  const f = endpoint(); const response = await f.get();
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal((await response.json()).unreadCount, 2);
  assert.equal((await f.patch()).status, 200);
  assert.equal(f.db.rows.find(row => row.id === id(2)).read_at, null);
  for (const f of [endpoint('admin', 'reviewer'), endpoint('admin', 'billing'), endpoint('unknown'), endpoint('customer', 'owner', false)]) {
    assert.ok([401, 403].includes((await f.get()).status));
    assert.ok([401, 403].includes((await f.patch()).status)); assert.equal(f.serviceCalls(), 0);
  }
  for (const scope of ['owner', 'support']) assert.equal((await endpoint('admin', scope).get()).status, 200);
  const bad = endpoint(); assert.equal((await bad.patch([])).status, 400); assert.equal(bad.serviceCalls(), 0);
});
