import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import { createRootContentSecurityPolicy } from '../src/lib/security/root-content-security-policy.mjs';

class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const invitation = 'vip_' + 'a'.repeat(48);
const userId = '97000000-0000-4000-8000-000000000001';
const week = 7 * 86400000;
const setupKey = 'mydancr_password_setup_completed_at', loginKey = 'mydancr_password_login_at';
const passwordSetup = compileVip('src/lib/dancr/password-setup.ts');

function fixture(options = {}) {
  const now = Date.now(), expiresAt = new Date(now + week).toISOString();
  const user = { id: userId, email: 'guest@example.test', user_metadata: { role: 'customer' }, app_metadata: {}, email_confirmed_at: new Date(now).toISOString(), ...options.user };
  const account = options.account === undefined ? { id: userId, email: user.email, role: 'customer', accountState: 'active' } : options.account;
  const calls = [], emails = [];
  let live = true, gets = 0;
  const admin = { from: table => {
    const chain = { select: () => chain, eq: () => chain, is: () => chain, gt: () => chain, maybeSingle: async () => ({ data: table === 'app_users' ? options.missingProfile ? null : { id: userId, role: account?.role, account_state: account?.accountState } : live ? { email: options.invitedEmail || 'guest@example.test' } : null }) };
    return chain;
  }, auth: { admin: {
    getUserById: async id => { gets++; calls.push(['get', id]); if (options.onRead) options.onRead(user, gets); return { data: { user: options.deleted ? null : user }, error: options.readError }; },
    generateLink: async input => { calls.push(['generate', input]); return { data: { user: { ...user, id: options.generatedId || userId }, properties: { hashed_token: 'short-lived-otp', verification_type: 'magiclink' } }, error: options.generateError }; },
  } } };
  const service = compileVip('src/lib/dancr/vip-setup-link.ts', {
    '../server-env': { getOptionalServerEnv: () => null, getServerEnv: () => 'synthetic-signing-secret' },
    '../api-error-policy': { PublicApiError },
    './vip': { vipTokenDigest: value => { if (!/^vip_[A-Za-z0-9_-]{48}$/.test(value)) throw new PublicApiError('NOT_FOUND','invalid',404); return 'digest'; },
      resolveVipInvitation: async () => { calls.push(['invitation']); if (!live) throw new PublicApiError('NOT_FOUND','revoked',404); return { expiresAt }; } },
    './auth': { getAccountByUserId: async () => account },
    './password-setup': passwordSetup,
    './account-profile-recovery': { recoverVerifiedPublicAccount: async (_admin, verified) => { calls.push(['recover', verified.id]); return account || { id: userId, role: 'customer', accountState: 'active' }; } },
    './public-app-url': { publicAppUrl: () => 'https://mydancr.test' },
    './notification-delivery': { sendTransactionalEmail: async input => { emails.push(input); return { delivered: !options.deliveryFails }; } },
    '../supabase/server': { createServerSupabaseClient: () => ({ auth: {
      verifyOtp: async input => { calls.push(['verify', input]); if (options.revokeDuringVerify) live = false; return { data: { user, session: { access_token: 'access', refresh_token: 'refresh', expires_at: 123456 } }, error: options.verifyError }; },
      signOut: async input => { calls.push(['signOut', input]); },
    } }) },
  }, { Buffer });
  const token = service.createVipSetupToken(invitation, user, expiresAt, now);
  return { service, token, user, now, expiresAt, calls, emails, admin, revoke: () => { live = false; },
    redeem: () => service.redeemVipSetupLink(admin, service.readVipSetupToken(token)),
    send: metadata => service.sendVipSetupLink(admin, { invitation, email: 'guest@example.test', expiresAt, ...(metadata ? { metadata } : {}) }) };
}

test('signed setup links are reusable through the original seven-day deadline, never beyond it', () => {
  const f = fixture();
  for (const time of [f.now, f.now + 86400000, f.now + week - 1]) {
    for (let i = 0; i < 2; i++) assert.equal(f.service.readVipSetupToken(f.token, time).userId, userId);
  }
  assert.throws(() => f.service.readVipSetupToken(f.token, f.now + week), { status: 404 });
  assert.throws(() => f.service.readVipSetupToken(f.token, f.now - 1), { status: 404 });
  const daySix = f.service.createVipSetupToken(invitation, f.user, f.expiresAt, f.now + 6 * 86400000);
  assert.equal(f.service.readVipSetupToken(daySix, f.now + 6 * 86400000).expiresAt, f.now + week);
  const long = f.service.createVipSetupToken(invitation, f.user, new Date(f.now + 2 * week).toISOString(), f.now);
  assert.equal(f.service.readVipSetupToken(long, f.now).expiresAt, f.now + week);
  const payload = JSON.parse(Buffer.from(f.token.slice(5).split('.')[0], 'base64url').toString());
  assert.equal(JSON.stringify(payload).includes(f.user.email), false);
});

test('modified, malformed and plain invitation tokens cannot authorize a session', () => {
  const f = fixture();
  const [encoded, signature] = f.token.slice(5).split('.');
  const forged = JSON.parse(Buffer.from(encoded, 'base64url').toString()); forged.userId = '97000000-0000-4000-8000-000000000002';
  for (const token of [invitation, '', null, {}, 'vips_' + 'a'.repeat(4096), `vips_${encoded}.${'b'.repeat(43)}`, `vips_${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`]) {
    assert.throws(() => f.service.readVipSetupToken(token), { status: 404 });
  }
});

test('the reusable credential is sent only to the invited inbox and never returned by send', async () => {
  const f = fixture();
  assert.equal(await f.send(), true); assert.equal(f.emails.length, 1);
  const email = f.emails[0]; assert.equal(email.to, f.user.email); assert.match(email.text, /7-day window/);
  assert.equal(email.subject, 'Confirm your email for MyDancr VIP');
  assert.match(email.html, />Confirm email<\/a>/);
  assert.match(email.text, /email will already be filled in/);
  assert.doesNotMatch(email.text + email.html, /Send password setup link|Finish password setup/);
  const url = new URL(email.text.split('\n')[1]);
  assert.equal(email.html.match(/href="([^"]+)"/)[1], url.href);
  assert.equal(url.origin, 'https://mydancr.test'); assert.equal(url.pathname, '/auth/vip-setup'); assert.equal(url.search, '');
  const token = new URLSearchParams(url.hash.slice(1)).get('link');
  assert.equal(f.service.readVipSetupToken(token).userId, userId);
  assert.equal(f.calls.some(c => c[0] === 'generate'), false);
});

test('public start requires signup metadata to create an identity; resume and non-guest accounts cannot', async () => {
  const fresh = fixture({ missingProfile: true, account: null });
  await fresh.send(); assert.equal(fresh.emails.length, 0); assert.equal(fresh.calls.length, 0);
  await fresh.send({ role: 'customer', user_terms_intent: 'terms-intent' });
  assert.equal(fresh.emails.length, 1);
  const input = fresh.calls.find(c => c[0] === 'generate')[1];
  assert.equal(input.type, 'magiclink'); assert.equal(input.options.data.role, 'customer'); assert.equal(input.password, undefined);
  for (const account of [{ role: 'venue', accountState: 'active' }, { role: 'customer', accountState: 'disabled' }]) {
    const f = fixture({ account }); await f.send(); assert.equal(f.emails.length, 0); assert.equal(f.calls.length, 0);
  }
  const wrong = fixture({ user: { email: 'changed@example.test' } }); await wrong.send(); assert.equal(wrong.emails.length, 0);
  const failed = fixture({ deliveryFails: true }); await assert.rejects(failed.send(), { status: 503 });
});

test('repeated confirmation and password-only completion keep the same email link usable', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    if (i === 2) f.user.app_metadata[setupKey] = new Date().toISOString();
    const result = await f.redeem();
    assert.equal(result.complete, false); assert.equal(result.account.id, userId); assert.equal(result.session.accessToken, 'access');
  }
  assert.equal(f.calls.filter(c => c[0] === 'verify').length, 3);
  assert.ok(f.calls.filter(c => c[0] === 'verify').every(c => c[1].type === 'email' && c[1].token_hash === 'short-lived-otp'));
  assert.equal(f.calls.filter(c => c[0] === 'signOut').length, 0);
  f.user.app_metadata[loginKey] = new Date().toISOString();
  const result = await f.redeem();
  assert.equal(result.complete, true); assert.equal(result.session, undefined);
  assert.equal(f.calls.filter(c => c[0] === 'generate').length, 3);
});

test('revocation, replacement, deleted accounts and identity changes invalidate setup before auth', async () => {
  const revoked = fixture(); revoked.revoke(); await assert.rejects(revoked.redeem(), { status: 404 });
  for (const options of [{ deleted: true }, { invitedEmail: 'someoneelse@example.test' }, { account: { role: 'dancer', accountState: 'active' } }, { account: { role: 'customer', accountState: 'disabled' } }, { account: null, user: { user_metadata: { role: 'admin' } } }]) {
    const f = fixture(options); await assert.rejects(f.redeem(), { status: 404 });
    assert.equal(f.calls.some(c => c[0] === 'generate'), false);
  }
  const changed = fixture(); changed.user.email = 'changed@example.test'; await assert.rejects(changed.redeem(), { status: 404 });
  const mismatch = fixture({ generatedId: 'another-user' }); await assert.rejects(mismatch.redeem(), { status: 404 });
  assert.equal(mismatch.calls.some(c => c[0] === 'verify'), false);
  const outage = fixture({ readError: { status: 503 } }); await assert.rejects(outage.redeem(), { status: 503 });
});

test('revocation or completion during the Auth exchange cannot release the newly issued session', async () => {
  const revoked = fixture({ revokeDuringVerify: true }); await assert.rejects(revoked.redeem(), { status: 404 });
  assert.equal(revoked.calls.filter(c => c[0] === 'signOut').length, 1);
  const completed = fixture({ onRead: (user, read) => { if (read > 1) user.app_metadata = { [setupKey]: new Date().toISOString(), [loginKey]: new Date().toISOString() }; } });
  const result = await completed.redeem(); assert.equal(result.complete, true); assert.equal(result.session, undefined);
  assert.equal(completed.calls.find(c => c[0] === 'signOut')[1].scope, 'local');
});

function landingFixture({ result, failure = false, changed = false, storageFails = false, noLink = false } = {}) {
  const route = compileVip('app/auth/vip-setup/route.ts', {
    '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY: 'session' },
    '@/src/lib/security/root-content-security-policy.mjs': { createRootContentSecurityPolicy },
  }, { Response });
  return (async () => {
    const response = route.GET(), html = await response.text(), script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const nodes = { status: { textContent: '' }, retry: { hidden: true, addEventListener: (_, callback) => { nodes.retry.click = callback; } } };
    const calls = [], destinations = []; let stored = null;
    const window = { location: { hash: noLink ? '' : '#link=private-credential', replace: url => destinations.push(url) },
      history: { replaceState: (...args) => calls.push(['history', ...args]) },
      localStorage: { getItem: () => { if (storageFails) throw new Error('Storage unavailable'); return stored; }, setItem: (_, value) => { stored = value; } },
    };
    vm.runInNewContext(script, { window, document: { getElementById: id => nodes[id] }, URLSearchParams, AbortSignal, Error,
      fetch: async (url, input) => { calls.push(['fetch', url, input]); if (changed) stored = 'other-account'; return { ok: !failure, json: async () => result || { ok: true, returnTo: '/vip/invite/' + invitation, complete: false, account: { id: userId, role: 'customer', accountState: 'active' }, session: { accessToken: 'access', refreshToken: 'refresh' } } }; },
    });
    await new Promise(resolve => setImmediate(resolve));
    return { response, html, calls, destinations, nodes, stored: () => stored };
  })();
}

test('standalone email landing clears the fragment before exchange and safely stores the verified guest session', async () => {
  const f = await landingFixture();
  assert.equal(f.calls[0][0], 'history'); assert.equal(f.calls[0][3], '/auth/vip-setup');
  assert.equal(f.calls[1][1], '/api/vip/setup'); assert.equal(JSON.parse(f.calls[1][2].body).link, 'private-credential');
  assert.match(f.response.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.match(f.response.headers.get('cache-control'), /no-store/);
  assert.equal(f.response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(JSON.parse(f.stored()).account.id, userId);
  assert.equal(f.destinations[0], '/account/reset-password?setup=1&return_to=' + encodeURIComponent('/vip/invite/' + invitation));
  assert.doesNotMatch(f.html, /<script[^>]+src=|<iframe/);
});

test('landing refuses changed sessions, blocked storage, bad destinations and failures; completed links do not sign in', async () => {
  for (const options of [{ changed: true }, { storageFails: true }, { noLink: true }, { result: { ok: true, returnTo: '//evil.test' } }, { failure: true, result: { ok: false, error: 'Try later' } }]) {
    const f = await landingFixture(options); assert.equal(f.destinations.length, 0); assert.ok(f.nodes.status.textContent);
    assert.equal(f.stored(), options.changed ? 'other-account' : null);
  }
  const retry = await landingFixture({ failure: true }); assert.equal(retry.nodes.retry.hidden, false);
  await retry.nodes.retry.click(); assert.equal(retry.calls.filter(c => c[0] === 'fetch').length, 2);
  const done = await landingFixture({ result: { ok: true, complete: true, returnTo: '/vip/invite/' + invitation } });
  assert.equal(done.stored(), null); assert.equal(done.destinations[0], '/vip/invite/' + invitation);
});

test('exchange requires signed proof before any privileged call, with bounded bodies and durable throttling', async () => {
  class RateError extends Error { constructor() { super(); this.retryAfterSeconds = 120; } }
  const calls = []; let limited = false;
  const route = compileVip('app/api/vip/setup/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/api': { apiError: error => Response.json({ ok: false, error: error.message }, { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: async (request, input) => { assert.equal(input.maxBytes, 4096); return request.json(); } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => { calls.push('admin'); return {}; } },
    '@/src/lib/dancr/vip-setup-link': { readVipSetupToken: input => { if (input !== 'signed-proof') throw new PublicApiError('NOT_FOUND', 'Invalid link', 404); return { userId }; }, redeemVipSetupLink: async () => { calls.push('redeem'); return { complete: true, returnTo: '/vip/invite/' + invitation }; } },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError: RateError, enforcePublicRequestRateLimit: async (_, input) => { calls.push('limit'); assert.equal(input.subject, userId); if (limited) throw new RateError(); } },
    '@/src/lib/dancr/vip': { VIP_HEADERS: { 'cache-control': 'private, no-store' }, vipError: error => error },
  }, { Response });
  const post = link => route.POST(new Request('https://mydancr.test/api/vip/setup', { method: 'POST', body: JSON.stringify({ link }) }));
  assert.equal((await post(invitation)).status, 404); assert.equal(calls.length, 0);
  assert.equal((await post('signed-proof')).status, 200); assert.deepEqual(calls, ['admin', 'limit', 'redeem']);
  calls.length = 0; limited = true;
  const response = await post('signed-proof'); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '120'); assert.deepEqual(calls, ['admin', 'limit']);
});
