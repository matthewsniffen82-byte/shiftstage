import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { pickupFixture, pickupId as id } from './helpers/pickup-fixture.mjs';
import { normalizeShuttleRequest } from '../src/lib/dancr/club-deal-transportation.ts';
import { pickupDate, pickupPageOffset, pickupUuid } from '../src/lib/dancr/pickup-validation.ts';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const compile = file => ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = compile('src/lib/dancr/pickup-phone-requests.ts');
const receipt = (n, venue = 10) => ({ id: id(n), venue_id: id(venue), created_at: '2026-09-15T07:46:33Z',
  notification_rows: [3, 5].map(user => ({ recipient_id: id(user), payload: { kind: 'club_shuttle_request', requestId: id(n),
    venueId: id(venue), name: 'Synthetic Guest', location: 'Synthetic hotel lobby', phone: '+17025550123', email: 'guest@example.test', partySize: 2 } })) });

function loader(client, rows = [receipt(20), receipt(21, 11)]) {
  const exports = {}, calls = [], state = { failRead: false };
  vm.runInNewContext(compiled, { exports, Map, Date, require(name) {
    if (name === 'server-only') return {};
    if (name.endsWith('api-error-policy')) return { PublicApiError };
    if (name.endsWith('club-deal-transportation')) return { normalizeShuttleRequest };
    if (name.endsWith('pickup-validation')) return { pickupDate, pickupPageOffset, pickupUuid };
    if (name.endsWith('supabase/admin')) return { createAdminSupabaseClient: () => ({ from(table) {
      assert.equal(table, 'club_shuttle_requests');
      const call = { table, filters: [], order: [] }; calls.push(call);
      return {
        select(columns) { call.columns = columns; return this; },
        in(column, values) { assert.equal(column, 'venue_id'); call.venues = [...values]; return this; },
        order(column, options) { call.order.push([column, options.ascending]); return this; },
        range(start, end) { call.range = [start, end]; return this; },
        gte(column, value) { call.filters.push(['gte', column, value]); return this; },
        lt(column, value) { call.filters.push(['lt', column, value]); return this; },
        then(resolve) {
          assert.ok(call.venues.length, 'service query must have an authorized venue scope');
          return Promise.resolve({ data: rows.filter(row => call.venues.includes(row.venue_id)).slice(call.range[0], call.range[1] + 1),
            error: state.failRead ? { message: 'private database error' } : null }).then(resolve);
        },
      };
    } }) };
    throw new Error('Unexpected import ' + name);
  } });
  return { run: (query = '') => exports.listPhonePickupRequests(client, new URLSearchParams(query)), calls, state };
}

test('phone receipts use current database owner/manager authorization, including revocation and disabled accounts', async () => {
  const { db, asUser } = await pickupFixture(['20260914190000_club_pickup_domain.sql',
    '20260914191000_club_pickup_security_commands.sql', '20260914192000_club_pickup_inbox_queries.sql']);
  try {
    const f = loader({ rpc: async name => {
      assert.equal(name, 'pickup_manageable_venues');
      return { data: (await db.query('select pickup_manageable_venues() venues')).rows[0].venues, error: null };
    } });
    for (const user of [3, 5]) {
      await asUser(user);
      const result = await f.run();
      assert.equal(result.phoneRequests.length, 1);
      assert.equal(result.phoneRequests[0].id, id(20));
      assert.equal(result.phoneRequests[0].phone, '+17025550123');
      assert.equal(result.phoneRequests[0].venue_name, 'Test Club');
      assert.equal(result.hasMorePhoneRequests, false);
      assert.deepEqual(Object.keys(result.phoneRequests[0]).sort(), ['email','id','location','name','party_size','phone','requested_at','venue_id','venue_name']);
      assert.equal((await f.run('venueId=' + id(11))).phoneRequests.length, 0);
    }
    await asUser(4); assert.equal((await f.run()).phoneRequests[0].id, id(21));
    await asUser(7); assert.equal((await f.run()).phoneRequests.length, 2);
    for (const user of [1, 2, 6, 8]) {
      await asUser(user); const reads = f.calls.length;
      assert.equal((await f.run()).phoneRequests.length, 0);
      assert.equal(f.calls.length, reads, 'customer, dancer and staff access never triggers a service read');
    }
    await db.exec("reset role; update venue_team_members set status='removed'");
    await asUser(5); assert.equal((await f.run()).phoneRequests.length, 0);
    await db.exec(`reset role; update app_users set account_state='disabled' where id='${id(3)}'`);
    await asUser(3); assert.equal((await f.run()).phoneRequests.length, 0);
    await asUser(null, 'anon'); await assert.rejects(f.run());
  } finally { await db.close(); }
});

test('phone inbox bounds independent pagination and filters and fails closed on access or receipt errors', async () => {
  const client = { rpc: async () => ({ data: [{ id: id(10), name: 'Test Club' }], error: null }) };
  const rows = Array.from({ length: 35 }, (_, n) => receipt(n + 20));
  const f = loader(client, rows);
  let result = await f.run();
  assert.equal(result.phoneRequests.length, 30); assert.equal(result.hasMorePhoneRequests, true);
  result = await f.run('phoneOffset=30&from=2026-09-14&to=2026-09-15');
  assert.equal(result.phoneRequests.length, 5); assert.equal(result.hasMorePhoneRequests, false);
  assert.equal(result.phoneRequests[0].id, id(50));
  assert.deepEqual(f.calls.at(-1).range, [30, 60]);
  assert.deepEqual(f.calls.at(-1).order, [['created_at', false], ['id', false]]);
  assert.deepEqual(f.calls.at(-1).filters, [['gte','created_at','2026-09-14T00:00:00Z'], ['lt','created_at','2026-09-16T00:00:00.000Z']]);
  for (const query of ['phoneOffset=-1', 'phoneOffset=10001', 'venueId=bad', 'from=2026-02-31']) await assert.rejects(f.run(query), e => e.status === 400);
  const reads = f.calls.length;
  for (const query of ['group=completed', 'group=closed', 'status=accepted', 'venueId=' + id(11)]) assert.equal((await f.run(query)).phoneRequests.length, 0);
  assert.equal(f.calls.length, reads);
  f.state.failRead = true; await assert.rejects(f.run(), e => e.status === 503 && !e.message.includes('private database'));
  await assert.rejects(loader({ rpc: async () => ({ error: {} }) }).run(), e => e.status === 503);
  await assert.rejects(loader(client, [{ ...receipt(20), notification_rows: [] }]).run(), e => e.status === 503);
});

test('pickup API includes phone receipts only for authenticated venue/admin roles and keeps errors private and uncached', async () => {
  const compiledRoute = compile('app/api/pickups/route.ts');
  for (const role of ['customer', 'venue', 'admin', 'signed-out', 'disabled', 'read-error']) {
    const exports = {}; let phoneReads = 0;
    vm.runInNewContext(compiledRoute, { exports, URL, require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => Response.json(body, options) } };
      if (name.endsWith('/api')) return { apiError: error => Response.json({ ok: false }, { status: error.status || 503 }) };
      if (name.endsWith('/supabase/request')) return { createRequestSupabaseContext: async (_, access) => {
        assert.equal(access.active, true);
        if (role === 'signed-out' || role === 'disabled') throw { status: role === 'signed-out' ? 401 : 403 };
        return { client: 'authenticated-client', session: { accessToken: 'synthetic-token' } };
      } };
      if (name.endsWith('/pickup-server')) return { listPickups: async client => { assert.equal(client, 'authenticated-client'); return { role, requests: [], hasMore: false }; } };
      if (name.endsWith('/pickup-phone-requests')) return { listPhonePickupRequests: async client => {
        assert.equal(client, 'authenticated-client'); phoneReads++;
        if (role === 'read-error') throw { status: 503 };
        return { phoneRequests: [{ id: id(20) }], hasMorePhoneRequests: false };
      } };
      return {};
    } });
    const response = await exports.GET(new Request('https://app.example.test/api/pickups?group=active'));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.status, role === 'signed-out' ? 401 : role === 'disabled' ? 403 : role === 'read-error' ? 503 : 200);
    assert.equal(phoneReads, ['venue', 'admin', 'read-error'].includes(role) ? 1 : 0);
    if (role === 'customer') assert.deepEqual((await response.json()).phoneRequests, []);
  }
});
