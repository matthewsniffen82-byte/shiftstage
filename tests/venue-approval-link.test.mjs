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

function alertFixture(role = 'venue', legacy = false, options = {}) {
  const f = fixture(options);
  Object.assign(f.account, { role, email:f.user.email });
  f.access.permissions = ['manage_roster'];
  const path = role === 'customer' ? '/vip?requestId='+requestId+'#vip-requests' : role === 'venue' ? '/dashboard/venue#venue-vip' : '/dashboard/dancer?mediaClub='+venueId+'#dancer-profile-video-library';
  const receipt = { id:requestId, recipient_id:userId, recipient_role:role, venue_id:role === 'venue' ? venueId : null,
    used_at:null, attempt_id:null, review_kind: legacy ? 'media' : null, email_tag: null };
  const admin = { auth:{...f.admin.auth, getUser:async bearer=>({data:{user:{id:bearer==='mine'?userId:'other'}}})},
    rpc:async (name, args) => {
      assert.equal(name,'prepare_notification_email_signin');
      assert.equal(args.p_role,role); assert.equal(args.p_recipient,userId);
      receipt.email_tag=args.p_email_tag;
      return {data:requestId};
    },
    from(table){
      assert.equal(table,'notification_email_signins');
      let patch, predicate=()=>true;
      const terms=[];
      const run=()=>{
        if (!terms.every(([key,value])=>receipt[key]===value) || !predicate()) return {data:null};
        Object.assign(receipt,patch);
        return {data:{...receipt}};
      };
      const q={select:()=>q, update:values=>{patch=values;return q;},
        eq:(key,value)=>{terms.push([key,value]);return q;}, is:(key,value)=>{terms.push([key,value]);return q;},
        or:()=>{predicate=()=>!receipt.attempt_id || receipt.attempt_id===patch.attempt_id || Date.parse(receipt.attempt_until)<Date.now();return q;},
        maybeSingle:async()=>run(),then:(resolve,reject)=>Promise.resolve(run()).then(resolve,reject)};
      return q;
    } };
  const service=compile('src/lib/dancr/notification-email-link.ts',{
    './venue-approval-link':f.service, './auth':{getAccountByUserId:async()=>f.account}, './venue-access':{getVenueAccess:async()=>f.access},
    '../server-env':{getServerEnv:()=>'synthetic-email-secret'}, '../api-error-policy':{PublicApiError},
    './public-app-url':{publicAppUrl:()=>'https://www.mydancr.com'}, './notification-email-path':compile('src/lib/dancr/notification-email-path.ts'),
  });
  const review=compile('src/lib/dancr/venue-review-link.ts',{'./notification-email-link':service,
    '../server-env':{getServerEnv:()=>'synthetic-review-key'}, '../api-error-policy':{PublicApiError}});
  if (legacy) receipt.email_tag=require('node:crypto').createHash('sha256').update(f.user.email).digest('hex');
  const mail={source:'notification',recipientId:userId,deliveryId:requestId,role,email:f.user.email};
  const link=(dest=path)=>service.notificationEmailUrl(admin,mail,dest);
  const token=url=>new URLSearchParams(new URL(url).hash.slice(1)).get('link');
  const redeem=async(bearer,attempt,kind='media')=>legacy
    ? review.redeemVenueReviewLink(admin,review.readVenueReviewToken(review.venueReviewToken(requestId,mail.email)),bearer,attempt,kind)
    : service.redeemNotificationEmail(admin,service.readNotificationEmailToken(token(await link()),path),bearer,attempt);
  return {...f,receipt,link,path,service,token,redeem,review,complete:(id=userId)=>service.completeNotificationEmail(admin,id,requestId)};
}

test('signed email links bind the recipient and exact routine destination and keep credentials out of the URL',async()=>{
  for(const role of ['venue','dancer','customer']){
    const f=alertFixture(role);
    const url=new URL(await f.link());
    assert.equal(await f.link(),url.href);
    assert.equal(url.searchParams.get('to'),f.path);
    assert.equal(url.pathname,'/auth/notification');
    assert.doesNotMatch(url.href,/example.test|club-access|club-refresh/);
    const token=f.token(url);
    assert.equal(f.service.readNotificationEmailToken(token,f.path).role,role);
    for(const path of ['/dashboard/admin','/dashboard/customer#customer-account','//another.example','/dashboard/dancer#dancer-account',f.path+'&next=/']){
      assert.throws(()=>f.service.readNotificationEmailToken(token,path),{status:403});
    }
    assert.throws(()=>f.service.readNotificationEmailToken(token.replace(requestId,venueId),f.path),{status:403});
    assert.doesNotMatch(await f.link('/account/reset-password'),/#link=/);
  }
});

test('routine and club review emails remain usable until the matching account arrives, including after abandoned exchanges',async()=>{
  for(const [role,legacy] of [['venue',true],['venue',false],['customer',false],['dancer',false]]){
    const f=alertFixture(role,legacy);
    for(let i=0;i<2;i++){
      const result=await f.redeem(undefined,userId);
      assert.equal(result.account.id,userId);assert.equal(result.completionId,requestId);assert.equal(f.receipt.used_at,null);
    }
    await assert.rejects(f.redeem(undefined,venueId),{status:409});
    f.receipt.attempt_until='2001-01-01T00:00:00Z';
    assert.equal((await f.redeem(undefined,venueId)).account.role,role);
    await f.complete(venueId);assert.equal(f.receipt.used_at,null);
    await f.complete();const used=f.receipt.used_at;assert.ok(used);await f.complete();assert.equal(f.receipt.used_at,used);
    assert.equal((await f.redeem()).signInRequired,true);
    assert.equal((await f.redeem('mine')).alreadySignedIn,true);
    assert.equal(f.calls.filter(([key])=>key==='generate').length,3);
  }
});

test('verified active identity and current club review permission are checked again before returning a session',async()=>{
  for(const mutate of [f=>{f.user.email='new@example.test';},f=>{f.account.email='new@example.test';},f=>{f.user.email_confirmed_at=null;},
    f=>{f.account.accountState='disabled';},f=>{f.account.role='admin';},f=>{f.access.venueId='other';},f=>{f.access.permissions=[];}]){
    const f=alertFixture('venue',true);
    mutate(f);await assert.rejects(f.redeem(),{status:403});assert.equal(f.calls.length,0);
  }
  const f=alertFixture('venue',true,{duringVerify:({access})=>{access.permissions=[];}});
  await assert.rejects(f.redeem(),{status:403});
  assert.equal(f.calls.at(-1)[0],'signOut');assert.equal(f.receipt.used_at,null);assert.equal(f.receipt.attempt_id,null);
  const mismatched=alertFixture('venue',true);
  await assert.rejects(mismatched.redeem(undefined,undefined,'dancer'),{status:403});
  const good=mismatched.review.venueReviewToken(requestId,mismatched.user.email);
  assert.equal(mismatched.review.venueReviewToken(requestId,mismatched.user.email.toUpperCase()),good);
  assert.throws(()=>mismatched.review.readVenueReviewToken(good.replace(requestId,userId)),{status:403});
});

test('provider errors, MFA and account conflicts preserve the email for the recipient',async()=>{
  const f=alertFixture('customer',false,{generateError:true});
  await assert.rejects(f.redeem(),/provider unavailable/);
  assert.equal(f.receipt.attempt_id,null);assert.equal(f.receipt.used_at,null);
  f.options.generateError=false;
  await assert.rejects(f.redeem('other-account'),{status:409});
  f.user.factors=[{status:'verified'}];
  assert.equal((await f.redeem()).signInRequired,true);
  const current=await f.redeem('mine');
  assert.equal(current.alreadySignedIn,true);assert.equal(current.completionId,requestId);assert.equal(f.receipt.used_at,null);
});

async function pageFixture(options = {}) {
  const page = compile('app/auth/venue-approval/route.ts', {
    '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY: 'session' },
    '@/src/lib/dancr/notification-email-path': compile('src/lib/dancr/notification-email-path.ts'),
    '@/src/lib/security/root-content-security-policy.mjs': { createRootContentSecurityPolicy },
  });
  const path = options.to ? '/auth/notification?to='+encodeURIComponent(options.to) : '/auth/venue-approval' + (options.review ? '?review='+options.review : '');
  const response = page.GET(new Request('https://www.mydancr.com' + path)); const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = {}, events = [], writes = [], navigations = [], timers = new Map();
  let resumeExchange;
  const waiting = options.waitForResponse && new Promise(resolve => { resumeExchange = resolve; });
  let stored = options.existing || null;
  const document = { getElementById: id => {
    const tag = html.match(new RegExp('<[^>]* id="' + id + '"[^>]*>'))?.[0];
    assert.ok(tag, id);
    return elements[id] ||= { hidden: /\bhidden\b/.test(tag), addEventListener(_name, fn) { this.click = fn; } };
  } };
  const result = options.signInRequired ? { ok:true, signInRequired:true } : options.alreadySignedIn ? { ok: true, alreadySignedIn: true } : { ok: true, account: { id: userId, role: options.role || 'venue', accountState: 'active' }, session: { accessToken: 'club-access', refreshToken: 'club-refresh' } };
  const tab = new Map(options.stashed ? [['mydancr:pending-review-login','synthetic-private-token']] : []);
  vm.runInNewContext(script, {
    URLSearchParams, JSON, Error, document, crypto:{randomUUID:()=>venueId}, AbortSignal: { timeout: () => undefined },
    window: { location: { hash: options.stashed || options.noProof ? '' : '#link=synthetic-private-token', replace: path => { events.push('navigate'); navigations.push(path); } },
      setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id),
      history: { replaceState: (...args) => { events.push('scrub'); assert.equal(args[2], path); if (options.historyBlocked) throw new Error('History blocked'); } },
      sessionStorage: { getItem: key => tab.get(key), setItem:(key,value)=>tab.set(key,value), removeItem: key => tab.delete(key) },
      localStorage: { getItem: () => stored, setItem: (_key, value) => { if (options.storageBlocked) throw new Error('Storage blocked'); stored = value; writes.push(value); events.push('save'); } } },
    fetch: async (path, init) => { events.push('exchange'); assert.equal(path, options.to ? '/api/auth/notification-login' : '/api/venue/approval-login'); assert.equal(init.method, 'POST');
      if (options.to) assert.equal(JSON.parse(init.body).to, options.to);
      assert.equal(JSON.parse(init.body).link,'synthetic-private-token');
      assert.equal(init.headers.authorization,options.authorization);
      if (waiting) await waiting;
      if (options.changeAccount) stored = 'newer-session';
      return { ok: !options.failed, json: async () => options.failed ? { ok: false, error: 'Try again later.' } : { ...result, completionId: options.completionId } }; },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { response, html, elements, events, writes, navigations, tab,
    showSlowProgress() { for (const fn of timers.values()) fn(); timers.clear(); },
    async finishExchange() { resumeExchange(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('email sign-in shows recovery controls only after an error and needs no extra tap to navigate', async () => {
  for (const options of [{}, { review: 'media' }, { role: 'customer', to: '/vip#vip-requests' }]) {
    const f = await pageFixture({ ...options, waitForResponse: true });
    assert.match(f.html, /<section id="recovery"[^>]* hidden>[\s\S]*?Sign in with email and password<\/a>\s*<\/section>/);
    assert.doesNotMatch(f.html, /id="continue"/);
    assert.equal(f.elements.progress.hidden, true);
    assert.equal(f.elements.recovery.hidden, true);
    f.showSlowProgress();
    assert.equal(f.elements.progress.hidden, false);
    assert.equal(f.elements.recovery.hidden, true);
    await f.finishExchange();
    assert.deepEqual(f.events, ['scrub','exchange','save','navigate']);
    assert.equal(f.elements.recovery.hidden, true);
  }
});

test('notification landing saves sign-in and an arrival marker before navigating to the exact destination',async()=>{
  for (const [role,to] of [['customer','/vip?requestId='+requestId+'#vip-requests'],['dancer','/dashboard/dancer?mediaClub='+venueId+'#dancer-profile-media-library'],['venue','/dashboard/venue#venue-guest-list']]) {
    const f=await pageFixture({role,to,completionId:requestId});
    assert.deepEqual(f.events,['scrub','exchange','save','navigate']);assert.deepEqual(f.navigations,[to]);
    assert.deepEqual(JSON.parse(f.tab.get('mydancr:email-arrival')),{id:requestId,accountId:userId,to});
    for (const fallback of [{signInRequired:true},{noProof:true}]) {
      const used=await pageFixture({role,to,...fallback});
      assert.deepEqual(used.navigations,[to]);assert.equal(used.writes.length,0);assert.equal(used.tab.has('mydancr:email-arrival'),false);
    }
  }
});

test('arrival is reported only from the signed-in destination and retried after a network failure',async()=>{
  const to='/dashboard/customer#customer-alerts', marker=JSON.stringify({id:requestId,accountId:userId,to});
  let effect, saved=marker,current='wrong',requests=0;
  const timers=[],listeners=new Map();
  const hook=compile('app/dashboard/useNotificationEmailArrival.ts',{
    react:{useEffect:cb=>{effect=cb;}},
    './dashboard-session':{readSession:()=>({account:{id:current}}),requestDashboardJson:async(path,opts)=>{
      assert.equal(path,'/api/auth/notification-login/complete');assert.deepEqual(JSON.parse(opts.body),{id:requestId});
      if (++requests===1) throw Error('offline');
    }},
  },{window:{location:{pathname:'/dashboard/customer',search:'',hash:'#customer-alerts'},sessionStorage:{getItem:()=>saved,removeItem:()=>{saved=null;}},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
    setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:()=>{}});
  hook.useNotificationEmailArrival(undefined);effect();assert.equal(requests,0);
  hook.useNotificationEmailArrival(userId);const cleanup=effect();assert.equal(requests,0);
  current=userId;await listeners.get('focus')();assert.equal(saved,marker);
  await timers.shift()();assert.equal(requests,2);assert.equal(saved,null);cleanup();
});

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
    f.showSlowProgress();
    assert.equal(f.elements.progress.hidden, true);
    assert.equal(f.elements.recovery.hidden, false);
  }
  const missing = await pageFixture({ noProof: true });
  assert.equal(missing.elements.recovery.hidden, false);
  assert.equal(missing.elements.retry.hidden, true);
  const blocked = await pageFixture({ historyBlocked: true });
  assert.deepEqual(blocked.events, ['scrub']);
  assert.equal(blocked.elements.recovery.hidden, false);
  assert.equal(blocked.elements.retry.hidden, true);
});

for (const [review,destination] of [['dancer','/dashboard/venue/approvals'],['media','/dashboard/venue#venue-media-reviews']]) {
  test(review+' review email saves the recipient session before opening its queue, including after site unlock', async () => {
    for (const stashed of [false,true]) {
      const f = await pageFixture({ review, stashed });
      assert.deepEqual(f.events,['scrub','exchange','save','navigate']);
      assert.deepEqual(f.navigations,[destination]);
      assert.equal(f.tab.has('mydancr:pending-review-login'),false);
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
