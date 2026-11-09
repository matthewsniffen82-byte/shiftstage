import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createRootContentSecurityPolicy } from '../src/lib/security/root-content-security-policy.mjs';

const require = createRequire(import.meta.url);
function compile(path, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, URLSearchParams, Buffer, Date, Request, Response, Error, AbortController,
    require: name => name in dependencies ? dependencies[name] : ['node:crypto', 'next/server'].includes(name) ? require(name) : {}, ...globals });
  return exports;
}
class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const userId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const venueId = '33333333-3333-4333-8333-333333333333';
const completedKey = 'mydancr_venue_approval_login';
function fixture(options = {}) {
  const row = { id: requestId, requester_user_id: userId, matched_venue_id: venueId, login_email: 'manager@example.test', status: 'approved', reviewed_at: '2026-10-25T12:00:00Z' };
  const user = { id: userId, email: row.login_email, email_confirmed_at: '2026-10-24T12:00:00Z', app_metadata: { mydancr_provisioned_role: 'venue' } };
  const account = { id: userId, role: 'venue', accountState: 'active' };
  const access = { venueId };
  const calls = [];
  const admin = {
    from(table) {
      assert.equal(table, 'venue_signup_requests');
      const filters = [];
      const q = { select: () => q, eq: (key, value) => { filters.push([key, value]); return q; }, maybeSingle: async () => ({ data: filters.every(([k,v]) => row[k] === v) ? row : null }) };
      return q;
    },
    auth: { admin: {
      getUserById: async id => { assert.equal(id, userId); return { data: { user }, error: null }; },
      generateLink: async input => { calls.push(['generate', input]); if (options.generateError) throw new Error('provider unavailable'); return { data: { user: { id: options.wrongGeneratedUser ? 'another-user' : userId }, properties: { hashed_token: 'transient-provider-proof' } }, error: null }; },
      updateUserById: async (id, input) => { calls.push(['complete', id, input]); if (options.recordError) throw new Error('record unavailable'); Object.assign(user.app_metadata, input.app_metadata); return { data: { user }, error: null }; },
    } },
  };
  const service = compile('src/lib/dancr/venue-approval-link.ts', {
    '../server-env': { getServerEnv: () => 'unit-test-only-signing-secret' }, '../api-error-policy': { PublicApiError },
    './public-app-url': { publicAppUrl: () => 'https://www.mydancr.com' },
    './auth': { requireActiveVenueAccount: async (_admin, id) => { assert.equal(id, userId); if (account.role !== 'venue' || account.accountState !== 'active') throw new PublicApiError('FORBIDDEN','Inactive club',403); return account; } },
    './venue-access': { requireVenueAccess: async () => access },
    '../supabase/server': { createServerSupabaseClient: () => ({ auth: {
      verifyOtp: async input => { calls.push(['verify', input]); options.duringVerify?.({ user, row, account, access }); return { data: { user: { ...user, id: options.wrongVerifiedUser ? 'another-user' : userId }, session: { access_token: 'club-access', refresh_token: 'club-refresh', expires_at: 123456789 } }, error: null }; },
      signOut: async input => { calls.push(['signOut', input]); },
    } }) },
  });
  return { service, row, user, account, access, calls, admin, options,
    async link() { return service.createVenueApprovalLink(admin, { requestId, userId, email: row.login_email }); },
    claim(url) { return service.readVenueApprovalToken(new URLSearchParams(new URL(url).hash.slice(1)).get('link')); },
    redeem(claim) { return service.redeemVenueApprovalLink(admin, claim); },
    complete(id = userId) { return service.completeVenueApprovalLogin(admin, id); },
  };
}

test('approval links carry private signed proof and do not have a timer expiry', async () => {
  const f = fixture(); const url = new URL(await f.link());
  assert.equal(url.origin, 'https://www.mydancr.com'); assert.equal(url.pathname, '/auth/venue-approval'); assert.equal(url.search, '');
  const claim = f.claim(url); assert.equal(claim.userId, userId); assert.equal(claim.venueId, venueId);
  assert.equal('expiresAt' in claim, false); assert.equal('email' in claim, false);
  f.row.reviewed_at = '2024-01-01T00:00:00Z';
  assert.equal((await f.redeem(f.claim(await f.link()))).account.id, userId);
  assert.equal(f.calls.filter(c => c[0] === 'complete').length, 0);
});

test('invalid signatures and a mismatched email recipient cannot issue sign-in links', async () => {
  const f = fixture(); const url = await f.link(); const token = new URLSearchParams(new URL(url).hash.slice(1)).get('link');
  const [body, signature] = token.split('.');
  for (const value of ['', 'vca_invalid.bad', token + 'x', body + '.' + (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1)]) {
    assert.throws(() => f.service.readVenueApprovalToken(value), { status: 403 });
  }
  await assert.rejects(f.service.createVenueApprovalLink(f.admin, { requestId, userId, email: 'someone-else@example.test' }), { status: 403 });
  assert.equal(f.calls.length, 0);
});

test('opening or retrying a link keeps it available until authenticated dashboard completion', async () => {
  const f = fixture(); const claim = f.claim(await f.link());
  for (let i = 0; i < 3; i++) assert.equal((await f.redeem(claim)).session.accessToken, 'club-access');
  assert.equal(f.user.app_metadata[completedKey], undefined);
  await f.complete(); await f.complete();
  assert.equal(f.calls.filter(c => c[0] === 'complete').length, 1);
  await assert.rejects(f.redeem(claim), { status: 403 });
  assert.equal(f.calls.filter(c => c[0] === 'generate').length, 3);
});

test('revoked approval, changed email, wrong venue, or disabled accounts reject an existing link', async () => {
  for (const mutate of [f => f.row.status = 'rejected', f => f.row.reviewed_at = '2026-10-26T12:00:00Z',
    f => f.user.email = 'changed@example.test', f => f.row.login_email = 'changed@example.test', f => f.user.email_confirmed_at = null,
    f => f.access.venueId = 'another-venue', f => f.account.role = 'admin', f => f.account.accountState = 'disabled',
    f => f.user.app_metadata.mydancr_provisioned_role = 'customer']) {
    const f = fixture(); const claim = f.claim(await f.link()); mutate(f);
    await assert.rejects(f.redeem(claim), { status: 403 });
    assert.equal(f.calls.filter(c => c[0] === 'generate').length, 0);
  }
});

test('completion during an Auth request rejects and signs out the newly issued session', async () => {
  const f = fixture({ duringVerify: ({ user, row }) => { user.app_metadata[completedKey] = `${row.id}:${row.reviewed_at}`; } });
  await assert.rejects(f.redeem(f.claim(await f.link())), { status: 403 });
  assert.equal(f.calls.at(-1)[0], 'signOut');
});

test('provider identity mismatches never return another account session', async () => {
  for (const options of [{ wrongGeneratedUser: true }, { wrongVerifiedUser: true }]) {
    const f = fixture(options); await assert.rejects(f.redeem(f.claim(await f.link())), { status: 403 });
    assert.equal(f.user.app_metadata[completedKey], undefined);
    if (options.wrongVerifiedUser) assert.equal(f.calls.at(-1)[0], 'signOut');
  }
});

test('failed session issuance or completion recording preserves a usable approval link', async () => {
  const f = fixture({ generateError: true, recordError: true }); const claim = f.claim(await f.link());
  await assert.rejects(f.redeem(claim), /provider unavailable/); f.options.generateError = false;
  assert.equal((await f.redeem(claim)).account.id, userId);
  await assert.rejects(f.complete(), /record unavailable/);
  assert.equal((await f.redeem(claim)).account.id, userId);
  f.options.recordError = false; await f.complete(); await assert.rejects(f.redeem(claim), { status: 403 });
});

test('completion cannot retire another manager’s link', async () => {
  const f = fixture(); const claim = f.claim(await f.link()); await f.complete('another-manager');
  assert.equal(f.user.app_metadata[completedKey], undefined); assert.equal((await f.redeem(claim)).account.id, userId);
});

test('an admin resend after successful entry creates a new generation without reviving retired links', async () => {
  const f = fixture(); const old = f.claim(await f.link()); await f.complete();
  const url = await f.service.createVenueApprovalLink(f.admin, { requestId, userId, email: f.row.login_email, reissue: true });
  const fresh = f.claim(url);
  await assert.rejects(f.redeem(old), { status: 403 });
  assert.equal((await f.redeem(fresh)).account.id, userId);
  const resent = f.claim(await f.service.createVenueApprovalLink(f.admin, { requestId, userId, email: f.row.login_email, reissue: true }));
  assert.equal(resent.nonce, fresh.nonce);
  await f.complete(); await assert.rejects(f.redeem(fresh), { status: 403 }); await assert.rejects(f.redeem(old), { status: 403 });
});

function reviewFixture(options = {}) {
  const f = fixture(options);
  f.account.email = f.user.email;
  f.access.permissions = ['manage_roster'];
  const receipt = { id:requestId, status:'accepted', recipient_id:userId, destination:f.user.email, venue_id:venueId,
    payload:{kind:'venue_dancer_approval_pending',emailPath:'/dashboard/venue#venue-dancer-approvals'}, finished_at:new Date().toISOString() };
  const consumed = new Set();
  const admin = { auth:{ ...f.admin.auth, getUser:async token => ({data:{user:{id:token === 'verified-manager' ? userId : 'other'}}}) },
    from(table) {
      assert.ok(['venue_email_events','venue_email_deliveries'].includes(table));
      const filters = {};
      const q = { select:() => q, eq:(key,value) => {filters[key]=value;return q;},
        maybeSingle:async () => {
          if (table === 'venue_email_events') return {data:consumed.has(filters.event_key) ? {event_key:filters.event_key} : null};
          assert.deepEqual(filters,{id:requestId,status:'accepted'});
          return {data:receipt.status === filters.status ? receipt : null};
        },
        insert:async ({event_key,venue_id}) => {
          assert.equal(table,'venue_email_events'); assert.equal(venue_id,venueId);
          if (consumed.has(event_key)) return {error:{code:'23505'}};
          consumed.add(event_key); return {error:null};
        } };
      return q;
    } };
  const review = compile('src/lib/dancr/venue-review-link.ts', {
    '../server-env':{getServerEnv:()=>'synthetic-review-signing-key'}, '../api-error-policy':{PublicApiError},
    './venue-approval-link':f.service, './venue-access':{getVenueAccess:async () => f.access},
    './auth':{requireActiveVenueAccount:async () => {
      if (f.account.accountState !== 'active' || f.account.role !== 'venue') throw new PublicApiError('FORBIDDEN','Inactive',403);
      return f.account;
    }},
  });
  const token = review.venueReviewToken(requestId,receipt.destination);
  const claim = review.readVenueReviewToken(token);
  return {...f, review, token, receipt, consumed, redeem:bearer => review.redeemVenueReviewLink(admin,claim,bearer)};
}

test('review proof is stable across delivery retries and bound to the delivery and original mailbox', () => {
  const f = reviewFixture();
  assert.equal(f.review.venueReviewToken(requestId,f.user.email.toUpperCase()),f.token);
  assert.notEqual(f.review.venueReviewToken(requestId,'other@example.test'),f.token);
  assert.doesNotMatch(f.token,/@|manager|club-access/);
  for (const bad of [f.token.replace(requestId,venueId),f.token+'x','',f.token.slice(0,-1)]) {
    assert.throws(() => f.review.readVenueReviewToken(bad),{status:403});
  }
});

test('a new session requires a recent accepted review, verified mailbox and active management of that club', async () => {
  for (const change of [f=>f.receipt.status='sending', f=>f.receipt.payload.kind='support_message',
    f=>f.receipt.payload.emailPath='/dashboard/venue', f=>f.receipt.destination='other@example.test',
    f=>f.user.email='other@example.test', f=>f.user.email_confirmed_at=null, f=>f.account.email='other@example.test',
    f=>f.access.venueId='another-club', f=>f.access.permissions=[], f=>f.account.accountState='disabled',
    f=>f.receipt.finished_at=new Date(Date.now()-3600000).toISOString()]) {
    const f=reviewFixture(); change(f);
    await assert.rejects(f.redeem(),{status:403}); assert.equal(f.calls.length,0);
  }
});

test('only one concurrent redemption can issue a session and subsequent requests require sign-in', async () => {
  const f=reviewFixture();
  const results=await Promise.allSettled([f.redeem(),f.redeem()]);
  assert.equal(results.filter(result=>result.status==='fulfilled' && result.value.account.id===userId).length,1);
  assert.equal(results.filter(result=>result.status==='rejected' && result.reason.status===403).length,1);
  assert.equal(f.calls.filter(([name])=>name==='signOut').length,1);
  const before=f.calls.length;
  await assert.rejects(f.redeem('unrelated-session'),{status:403});
  assert.equal((await f.redeem('verified-manager')).alreadySignedIn,true); assert.equal(f.calls.length,before);
});

test('opening with the recipient’s current session retires the unused proof without creating a session', async () => {
  const f=reviewFixture();
  assert.equal((await f.redeem('verified-manager')).alreadySignedIn,true);
  await assert.rejects(f.redeem(),{status:403}); assert.equal(f.calls.length,0);
});

test('a media-review email grants a session only for the matching media-review notification', async () => {
  const f=reviewFixture(); f.receipt.payload.kind='venue_media_pending';
  await assert.rejects(f.redeem(),{status:403}); assert.equal(f.calls.length,0);
  f.receipt.payload.emailPath='/dashboard/venue#venue-media-reviews';
  assert.equal((await f.redeem()).account.id,userId);
  await assert.rejects(f.redeem(),{status:403});
});

test('failed review session issuance preserves the link and mid-exchange revocation discards the session', async () => {
  const f=reviewFixture({generateError:true}); await assert.rejects(f.redeem(),/unavailable/);
  f.options.generateError=false;
  f.options.duringVerify=({access})=>{access.permissions=[];};
  await assert.rejects(f.redeem(),{status:403}); assert.equal(f.calls.at(-1)[0],'signOut');
  assert.equal(f.consumed.size,0);
  f.options.duringVerify=null; f.access.permissions=['manage_roster'];
  assert.equal((await f.redeem()).session.accessToken,'club-access');
});

async function pageFixture(options = {}) {
  const page = compile('app/auth/venue-approval/route.ts', {
    '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY: 'session' },
    '@/src/lib/security/root-content-security-policy.mjs': { createRootContentSecurityPolicy },
  });
  const path = '/auth/venue-approval' + (options.review ? '?review='+options.review : '');
  const response = page.GET(new Request('https://www.mydancr.com' + path)); const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = {}, events = [], writes = [], navigations = [];
  let stored = options.existing || null;
  const document = { getElementById: id => elements[id] ||= { hidden: true, addEventListener(_name, fn) { this.click = fn; } } };
  const result = options.alreadySignedIn ? { ok: true, alreadySignedIn: true } : { ok: true, account: { id: userId, role: 'venue', accountState: 'active' }, session: { accessToken: 'club-access', refreshToken: 'club-refresh' } };
  const tab = new Map(options.stashed ? [['mydancr:pending-review-login','synthetic-private-token']] : []);
  vm.runInNewContext(script, {
    URLSearchParams, JSON, Error, document, AbortSignal: { timeout: () => undefined },
    window: { location: { hash: options.stashed ? '' : '#link=synthetic-private-token', replace: path => { events.push('navigate'); navigations.push(path); } },
      history: { replaceState: (...args) => { events.push('scrub'); assert.equal(args[2], path); } },
      sessionStorage: { getItem: key => tab.get(key), removeItem: key => tab.delete(key) },
      localStorage: { getItem: () => stored, setItem: (_key, value) => { if (options.storageBlocked) throw new Error('Storage blocked'); stored = value; writes.push(value); events.push('save'); } } },
    fetch: async (path, init) => { events.push('exchange'); assert.equal(path, '/api/venue/approval-login'); assert.equal(init.method, 'POST');
      assert.equal(JSON.parse(init.body).link,'synthetic-private-token');
      assert.equal(init.headers.authorization,options.authorization);
      if (options.changeAccount) stored = 'newer-session';
      return { ok: !options.failed, json: async () => options.failed ? { ok: false, error: 'Try again later.' } : result }; },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { response, html, elements, events, writes, navigations, tab };
}

test('approval landing page saves the club session before navigating, even from an admin session', async () => {
  for (const existing of [null, JSON.stringify({ account: { role: 'admin' }, accessToken: 'admin-token' })]) {
    const f = await pageFixture({ existing });
    assert.deepEqual(f.events, ['scrub', 'exchange', 'save', 'navigate']);
    assert.equal(JSON.parse(f.writes[0]).account.id, userId); assert.deepEqual(f.navigations, ['/dashboard/venue']);
    assert.match(f.response.headers.get('cache-control'), /no-store/); assert.equal(f.response.headers.get('referrer-policy'), 'no-referrer');
    assert.doesNotMatch(f.html, /approval-login\/complete/);
  }
});

test('failed exchange, blocked storage and competing sign-ins do not navigate or consume the link', async () => {
  for (const options of [{ failed: true }, { storageBlocked: true }, { changeAccount: true }]) {
    const f = await pageFixture(options); assert.deepEqual(f.navigations, []); assert.equal(f.elements.retry.hidden, false); assert.equal(f.writes.length, 0);
  }
});

for (const [review,destination] of [['dancer','/dashboard/venue/approvals'],['media','/dashboard/venue#venue-media-reviews']]) {
  test(review+' review email saves the recipient session before opening its queue, including after site unlock', async () => {
    for (const stashed of [false,true]) {
      const f = await pageFixture({ review, stashed });
      assert.deepEqual(f.events,['scrub','exchange','save','navigate']);
      assert.deepEqual(f.navigations,[destination]);
      assert.equal(f.tab.size,0);
    }
  });
  test(review+' review email reuses a matching authenticated club session', async () => {
    const existing = JSON.stringify({account:{id:userId,role:'venue'},accessToken:'existing-club'});
    const f = await pageFixture({review, existing, authorization:'Bearer existing-club', alreadySignedIn:true});
    assert.deepEqual(f.events,['scrub','exchange','navigate']);
    assert.deepEqual(f.navigations,[destination]);
  });
}

test('dashboard completion requires successful account/venue state and retries transient failures', async () => {
  let effect, cleanup, calls = 0, current = userId;
  const timers = [], listeners = new Map();
  const hook = compile('app/dashboard/useVenueApprovalCompletion.ts', {
    react: { useEffect: callback => { effect = callback; } },
    './dashboard-session': { readSession: () => ({ account: { id: current } }), requestDashboardJson: async (_path, init) => { calls++; assert.equal(init.method, 'POST'); assert.equal(init.expectedRole, 'venue'); if (calls === 1) throw new Error('offline'); } },
  }, { window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    setTimeout: fn => { timers.push(fn); return fn; }, clearTimeout: fn => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); } });
  hook.useVenueApprovalCompletion(undefined, venueId); effect(); assert.equal(calls, 0);
  hook.useVenueApprovalCompletion(userId, undefined); effect(); assert.equal(calls, 0);
  hook.useVenueApprovalCompletion(userId, venueId); cleanup = effect(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); timers.shift()(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2);
  listeners.get('focus')(); assert.equal(calls, 2); cleanup(); assert.equal(listeners.size, 0);
  current = 'another-manager'; hook.useVenueApprovalCompletion(userId, venueId); cleanup = effect(); assert.equal(calls, 2); cleanup();
});

test('completion API uses the authenticated manager and never an ID supplied in the body', async () => {
  const calls = [];
  const route = compile('app/api/venue/approval-login/complete/route.ts', {
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async (_request, access) => { assert.equal(access.role, 'venue'); return { user: { id: userId } }; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => 'admin' },
    '@/src/lib/dancr/venue-approval-link': { VENUE_APPROVAL_HEADERS: { 'cache-control': 'no-store' }, completeVenueApprovalLogin: async (...args) => calls.push(args) },
  });
  const result = await route.POST(new Request('https://www.mydancr.com/api/venue/approval-login/complete', { method: 'POST', body: JSON.stringify({ userId: 'victim' }) }));
  assert.equal(result.status, 200); assert.deepEqual(calls, [['admin', userId]]);
});

test('exchange API validates private proof and enforces rate limits before session issuance', async () => {
  const calls = [];
  let limited = false, invalid = false, review = false;
  class RateError extends Error { retryAfterSeconds = 60; }
  const route = compile('app/api/venue/approval-login/route.ts', {
    '@/src/lib/api': { apiError: error => new Response(JSON.stringify({ ok: false, error: error.message }), { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: request => request.json() },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => 'admin' },
    '@/src/lib/dancr/public-request-rate-limit': { PublicRequestRateLimitError: RateError, enforcePublicRequestRateLimit: async (_admin, input) => { calls.push('limit'); assert.equal(input.subject, review ? requestId : userId); if (limited) throw new RateError(); } },
    '@/src/lib/dancr/venue-review-link': {
      readVenueReviewToken: () => { calls.push('review-proof'); if (invalid) throw new PublicApiError('FORBIDDEN','Invalid review',403); return {deliveryId:requestId}; },
      redeemVenueReviewLink: async (_admin, claim, bearer) => { assert.equal(claim.deliveryId,requestId); assert.equal(bearer,'existing-club'); calls.push('review-session'); return {alreadySignedIn:true}; } },
    '@/src/lib/dancr/venue-approval-link': { VENUE_APPROVAL_HEADERS: { 'cache-control': 'no-store' },
      readVenueApprovalToken: () => { calls.push('proof'); if (invalid) throw new PublicApiError('FORBIDDEN', 'Invalid link', 403); return { userId }; },
      redeemVenueApprovalLink: async () => { calls.push('session'); return { account: { id: userId } }; } },
  });
  const request = () => new Request('https://www.mydancr.com/api/venue/approval-login', { method: 'POST', headers:{authorization:'Bearer existing-club'}, body: JSON.stringify({ link: review ? 'vcr_synthetic' : 'private-proof' }) });
  assert.equal((await route.POST(request())).status, 200); assert.deepEqual(calls, ['proof','limit','session']);
  calls.length = 0; limited = true;
  const blocked = await route.POST(request()); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60'); assert.deepEqual(calls, ['proof','limit']);
  calls.length = 0; invalid = true;
  const rejected = await route.POST(request()); assert.equal(rejected.status, 403); assert.equal(rejected.headers.get('cache-control'), 'no-store'); assert.deepEqual(calls, ['proof']);
  calls.length=0; review=true;
  assert.equal((await route.POST(request())).status,403); assert.deepEqual(calls,['review-proof']);
  calls.length=0; invalid=false;
  assert.equal((await route.POST(request())).status,429); assert.deepEqual(calls,['review-proof','limit']);
  calls.length=0; limited=false;
  assert.equal((await route.POST(request())).status,200); assert.deepEqual(calls,['review-proof','limit','review-session']);
});

test('unauthenticated completion cannot revoke a private approval link', async () => {
  let completed = false;
  const route = compile('app/api/venue/approval-login/complete/route.ts', {
    '@/src/lib/api': { apiError: error => new Response('', { status: error.status }) },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => { throw new PublicApiError('UNAUTHORIZED', 'Sign in required', 401); } },
    '@/src/lib/dancr/venue-approval-link': { VENUE_APPROVAL_HEADERS: { 'cache-control': 'no-store' }, completeVenueApprovalLogin: async () => { completed = true; } },
  });
  const response = await route.POST(new Request('https://www.mydancr.com/api/venue/approval-login/complete', { method: 'POST' }));
  assert.equal(response.status, 401); assert.equal(completed, false);
});
