import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { pickupCommand, pickupCreateArgs, pickupUuid } from '../src/lib/dancr/pickup-validation.ts';
import { pickupId as id } from './helpers/pickup-fixture.mjs';

const key = 'a'.repeat(64);
const compile = file => ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('guest API validates capabilities and fields before using only scoped service commands', async () => {
  const calls = [], exports = {};
  vm.runInNewContext(compile('src/lib/dancr/pickup-guest-server.ts'), { exports, URL, process: { env: { DANCR_PUBLIC_RATE_LIMIT_SECRET: 'synthetic-secret' } }, require(name) {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return { createHash, createHmac };
    if (name.endsWith('/supabase/admin')) return { createAdminSupabaseClient: () => ({ synthetic: true }) };
    if (name.endsWith('/api-error-policy')) return { PublicApiError };
    if (name.endsWith('/request-client-address')) return { requestClientAddress: () => '192.0.2.1' };
    if (name.endsWith('/pickup-validation')) return { pickupCommand, pickupCreateArgs, pickupUuid };
    if (name.endsWith('/pickup-server')) return { pickupRpc: async (client, name, args) => { calls.push({ client, name, args }); return id(20); } };
    throw new Error('Unexpected import ' + name);
  } });
  const request = (token = key, query = '') => new Request('https://example.test/api/pickups/' + id(20) + query, { headers: token === null ? {} : { 'x-pickup-guest-key': token } });
  for (const token of [null, '', 'x'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    assert.throws(() => exports.pickupGuestKeyHash(request(token)), error => error.status === 401);
  }
  assert.equal(exports.pickupGuestKeyHash(request()), createHash('sha256').update(key).digest('hex'));
  const body = { requestId: id(20), venueId: id(10), location: 'Hotel lobby', partySize: 2, consentVersion: 'pickup-chat-v1' };
  await exports.createGuestPickup(request(), body);
  assert.equal(calls[0].name, 'pickup_guest_create');
  assert.equal(calls[0].args.p_key_hash, createHash('sha256').update(key).digest('hex'));
  assert.equal(calls[0].args.p_rate_key, createHmac('sha256', 'synthetic-secret').update('pickup-guest:192.0.2.1').digest('hex'));
  assert.equal(calls[0].args.p_id, id(20));
  assert.doesNotMatch(JSON.stringify(calls), /192\.0\.2\.1|synthetic-secret/);
  await assert.rejects(exports.createGuestPickup(request(), { ...body, customer_user_id: id(1) }), e => e.status === 400);
  await exports.getGuestPickup(request(key, '?before=123'), id(20));
  assert.equal(calls.at(-1).args.p_before, 123);
  for (const before of ['-1', 'NaN', '9007199254740992', '']) await assert.rejects(exports.getGuestPickup(request(key, '?before=' + before), id(20)), e => e.status === 400);
  await exports.commandGuestPickup(request(), id(20), { action: 'message', messageId: id(30), text: 'Hello' });
  assert.equal(calls.at(-1).name, 'pickup_guest_command'); assert.equal(calls.at(-1).args.p_command, 'pickup_send_message');
  const count = calls.length;
  await assert.rejects(exports.commandGuestPickup(request(), id(20), { action: 'admin_note', note: 'Impersonation' }), e => e.status === 403);
  await assert.rejects(exports.commandGuestPickup(request(), id(20), { action: 'message', messageId: id(30), text: 'Hello', sender_type: 'venue' }), e => e.status === 400);
  assert.equal(calls.length, count);
});

test('routes distinguish guest capability access from account access without falling back on failed authorization', async () => {
  for (const file of ['app/api/pickups/route.ts', 'app/api/pickups/[requestId]/route.ts']) {
    const calls = [], exports = {};
    const record = name => async () => { calls.push(name); return name === 'getGuestPickup' ? { role: 'customer', messages: [] } : id(20); };
    const fakeError = error => Response.json({ ok: false, error: error.message }, { status: error.status || 401 });
    vm.runInNewContext(compile(file), { exports, URL, require(name) {
      if (name === 'next/server') return { NextResponse: { json: Response.json } };
      if (name.endsWith('/api')) return { apiError: fakeError };
      if (name.endsWith('/bounded-json-body')) return { readBoundedJsonObject: request => request.json() };
      if (name.endsWith('/supabase/request')) return { createRequestSupabaseContext: async () => { calls.push('auth'); throw new Error('Sign in required.'); } };
      if (name.endsWith('/pickup-guest-server')) return { createGuestPickup: record('createGuestPickup'), getGuestPickup: record('getGuestPickup'), commandGuestPickup: record('commandGuestPickup') };
      if (name.endsWith('/pickup-validation')) return { pickupCommand, pickupCreateArgs };
      if (name.endsWith('/pickup-server') || name.endsWith('/pickup-phone-requests')) return {};
      throw new Error('Unexpected import ' + name);
    } });
    const params = { params: Promise.resolve({ requestId: id(20) }) };
    for (const method of file.includes('[requestId]') ? ['GET', 'POST'] : ['POST']) {
      calls.length = 0;
      const guest = new Request('https://example.test/api/pickups', { method, headers: { 'x-pickup-guest-key': key }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const result = await exports[method](guest, params);
      assert.equal(result.status, 200); assert.match(result.headers.get('cache-control'), /private, no-store/);
      assert.equal(calls.length, 1); assert.notEqual(calls[0], 'auth');
      calls.length = 0;
      const invalidAccount = new Request('https://example.test/api/pickups', { method, headers: { authorization: 'Bearer invalid', 'x-pickup-guest-key': key }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const denied = await exports[method](invalidAccount, params);
      assert.equal(denied.status, 401); assert.deepEqual(calls, ['auth']);
    }
  }
});

test('guest links survive reload without leaking keys into query strings and handle blocked storage', () => {
  const local = new Map(), exports = {};
  const window = { location: { pathname: '/pickups/' + id(20), hash: '#pickupKey=' + key } };
  let blocked = false;
  vm.runInNewContext(compile('src/lib/dancr/pickup-guest-session.ts'), { exports, window, URLSearchParams, Date, Map,
    localStorage: { getItem: name => local.get(name) || null, setItem: (name, value) => { if (blocked) throw new Error('Blocked'); local.set(name, value); } },
    crypto: { getRandomValues: array => { array.fill(255); return array; } },
  });
  assert.equal(exports.guestPickupKey(id(20)), key); assert.equal(exports.guestPickupKey(id(21)), '');
  const href = exports.guestPickupHref(id(20));
  assert.equal(new URL(href, 'https://example.test').search, '');
  const item = { id: id(20), key, venue: 'Test Club', savedAt: Date.now() };
  assert.equal(exports.rememberGuestPickup(item), true);
  window.location.hash = '';
  assert.equal(exports.guestPickupKey(id(20)), key);
  local.clear(); assert.equal(exports.guestPickupKey(id(20)), '', 'removing saved links clears access');
  blocked = true; assert.equal(exports.rememberGuestPickup(item), false);
  assert.equal(exports.guestPickupKey(id(20)), key, 'current page retains the link for copying');
  assert.equal(exports.newGuestPickupKey(), 'f'.repeat(64));
});
