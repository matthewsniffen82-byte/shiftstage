import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { safeLocalReturnPath } from '../src/lib/dancr/safe-return-path.ts';

const id = n => `97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(options = {}) {
  const actions = [], emails = [], authCalls = [];
  let account = { id: id(1), email: 'guest@example.invalid', role: options.role || 'customer', accountState: 'active' };
  const user = { id: account.id, email: account.email, email_confirmed_at: null };
  const controls = { deliveryFails: false, verifyFails: false, accountFails: false, passwordChanged: false, ...options };
  const admin = {
    from(table) {
      const filters = []; let operation = 'read', payload;
      const result = () => {
        const records = table === 'account_email_actions' ? actions : [{ id: account.id, email: account.email, account_state: account.accountState }];
        if (operation === 'insert') { const row = { id: id(actions.length + 10), current_confirmed_at: null, new_confirmed_at: null, completed_at: null, revoked_at: null, ...payload }; actions.push(row); return { data: { ...row } }; }
        const selected = records.filter(row => filters.every(fn => fn(row)));
        if (operation === 'update') selected.forEach(row => Object.assign(row, payload));
        return { data: selected[0] ? { ...selected[0] } : null };
      };
      const q = { select: () => q, order: () => q, limit: () => q,
        eq: (key,value) => { filters.push(row => row[key] === value); return q; },
        is: (key,value) => { filters.push(row => row[key] === value); return q; },
        insert: value => { operation = 'insert'; payload = value; return q; }, update: value => { operation = 'update'; payload = value; return q; },
        maybeSingle: async () => result(), single: async () => result(), then: resolve => Promise.resolve(result()).then(resolve),
      }; return q;
    },
    auth: { admin: {
      async getUserById() { return { data: { user: { ...user } } }; },
      async generateLink(input) { authCalls.push(input); return { data: { user: { ...user }, properties: { hashed_token: 'synthetic-one-time-provider-token' } } }; },
      async updateUserById(userId, input) { assert.equal(userId, user.id); authCalls.push(input); if(controls.updateFails)return {error:new Error('Temporary email update failure')}; Object.assign(user, input); return { data: { user: { ...user } } }; },
    } },
  };
  const exports = {};
  const dependencies = {
    'server-only': {}, 'node:crypto': crypto, '../api-error-policy': { PublicApiError },
    '../server-env': { getServerEnv: () => 'synthetic-test-secret' },
    '../supabase/server': { createServerSupabaseClient: () => ({ auth: {
      async verifyOtp(input) { authCalls.push(input); if (controls.verifyFails) return { error: new Error('Temporary verification failure') };
        user.email_confirmed_at = new Date().toISOString(); controls.duringVerify?.(actions); return { data: { user: { ...user }, session: { access_token: 'access', refresh_token: 'refresh', expires_at: 1000 } } }; },
      async signOut() { authCalls.push('signout'); },
    } }) },
    './auth': { async getAccountByUserId() { if (controls.accountFails) throw new Error('Account temporarily unavailable'); return { ...account }; } },
    './account-profile-recovery': { recoverVerifiedPublicAccount: async () => { throw new Error('Unexpected provisioning'); } },
    './public-app-url': { publicAppUrl: () => 'https://www.mydancr.com' },
    './notification-delivery': { async sendTransactionalEmail(input) { emails.push(input); return { delivered: !controls.deliveryFails }; } },
    './safe-return-path': { safeLocalReturnPath },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/email-actions.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Buffer, Date, Error, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const claim = (index = emails.length - 1) => exports.readEmailActionToken(new URL(emails[index].text.match(/https:\/\/[^\s]+/)[0]).hash.slice(6));
  return { service: exports, admin, user, account, actions, emails, authCalls, controls, claim,
    send: (purpose = 'confirmation', extra = {}) => exports.sendAccountEmailAction(admin, { userId: user.id, purpose, ...extra }),
    redeem: (value = claim()) => exports.redeemEmailAction(admin, value),
    finish: (value = claim(), userId = user.id) => exports.completeEmailConfirmation(admin, userId, value),
  };
}

for (const role of ['customer','dancer','venue','admin']) test(`${role} confirmation remains retryable until verification and authenticated completion succeed`, async () => {
  const f = fixture({ role }); await f.send(); const claim = f.claim();
  assert.equal(f.actions[0].completed_at, null); assert.equal(f.authCalls.length, 0);
  f.controls.verifyFails = true; await assert.rejects(f.redeem(claim)); assert.equal(f.actions[0].completed_at, null);
  f.controls.verifyFails = false;
  const result = await f.redeem(claim); assert.equal(result.account.role, role); assert.equal(result.session.accessToken, 'access');
  assert.equal(result.returnTo, role === 'admin' ? '/admin' : `/dashboard/${role}`);
  assert.equal(f.actions[0].completed_at, null);
  await f.redeem(claim); // An interrupted browser save can use the same email again.
  await assert.rejects(f.finish(claim, id(2)), /no longer available/);
  await f.finish(claim); assert.ok(f.actions[0].completed_at);
  await assert.rejects(f.redeem(claim), /already been completed/);
});

test('resending and delivery failures preserve the same pending credential', async () => {
  const f = fixture({ deliveryFails: true }); await assert.rejects(f.send(), /send the email/);
  f.controls.deliveryFails = false; await f.send(); await f.send();
  assert.equal(f.actions.length, 1); assert.equal(f.emails[0].text, f.emails[2].text);
  assert.equal(f.actions[0].completed_at, null); assert.equal(f.authCalls.length, 0);
  assert.doesNotMatch(f.emails[0].text, /expires|token_hash/);
});

test('password recovery can be reopened after verification and stops only after a successful password update', async () => {
  const f = fixture(); await f.send('recovery'); const claim = f.claim();
  for (let attempt = 0; attempt < 2; attempt++) { const result = await f.redeem(claim); assert.equal(result.returnTo, '/account/reset-password'); }
  assert.equal(f.actions[0].completed_at, null);
  await assert.rejects(f.finish(claim));
  // The credential-update trigger is exercised independently with real Postgres below.
  f.actions[0].completed_at = new Date().toISOString();
  await assert.rejects(f.redeem(claim));
});

test('matching-password completion closes only the authenticated account recovery actions', async () => {
  const f=fixture();await f.send('recovery');const claim=f.claim();await f.send('confirmation');
  await f.service.completePasswordRecovery(f.admin,id(2));assert.equal(f.actions[0].completed_at,null);
  await f.service.completePasswordRecovery(f.admin,f.user.id);assert.ok(f.actions[0].completed_at);assert.equal(f.actions[1].completed_at,null);
  await assert.rejects(f.redeem(claim));
});

test('an email-change provider failure retains both proofs so the same link can finish later', async () => {
  const f=fixture();await f.send('email_change',{newEmail:'new@example.invalid'});const current=f.claim(0),next=f.claim(1);
  await f.redeem(current);f.controls.updateFails=true;await assert.rejects(f.redeem(next));
  assert.equal(f.user.email,'guest@example.invalid');assert.equal(f.actions[0].completed_at,null);
  f.controls.updateFails=false;assert.equal((await f.redeem(next)).complete,true);assert.equal(f.user.email,'new@example.invalid');
});

test('VIP password recovery retains its return destination after the password form', async () => {
  const f=fixture();await f.send('recovery',{returnTo:'/vip'});
  assert.equal((await f.redeem()).returnTo,'/account/reset-password?return_to=%2Fvip');
});

test('signed credentials reject tampering, wrong sides, revoked requests and inactive accounts', async () => {
  const f = fixture(); await f.send(); const claim = f.claim();
  const raw = new URL(f.emails[0].text.match(/https:\/\/[^\s]+/)[0]).hash.slice(6);
  assert.throws(() => f.service.readEmailActionToken(raw.replace('.current.', '.new.')));
  assert.throws(() => f.service.readEmailActionToken(raw.replace(id(10), id(11))));
  f.account.accountState = 'disabled'; await assert.rejects(f.redeem(claim));
  f.account.accountState = 'active'; f.actions[0].revoked_at = new Date().toISOString(); await assert.rejects(f.redeem(claim));
  assert.equal(f.authCalls.length, 0);
});

test('revocation during session issuance prevents returning the newly issued session', async () => {
  const f = fixture({ duringVerify: actions => { actions[0].revoked_at = new Date().toISOString(); } }); await f.send();
  await assert.rejects(f.redeem()); assert.equal(f.authCalls.at(-1), 'signout');
});

test('email changes require both inbox proofs and remain retryable after the first proof', async () => {
  const f = fixture(); await f.send('email_change', { newEmail: 'new@example.invalid' });
  assert.equal(f.emails[0].to, 'guest@example.invalid'); assert.equal(f.emails[1].to, 'new@example.invalid');
  const old = f.claim(0), next = f.claim(1);
  assert.equal((await f.redeem(old)).pending, true); assert.equal((await f.redeem(old)).pending, true);
  assert.equal(f.user.email, 'guest@example.invalid'); assert.equal(f.authCalls.length, 0);
  assert.equal((await f.redeem(next)).complete, true); assert.equal(f.user.email, 'new@example.invalid');
  assert.ok(f.actions[0].completed_at); await assert.rejects(f.redeem(old));
});

test('a replacement email-change request retires the previous links without changing the account', async () => {
  const f = fixture(); await f.send('email_change', { newEmail: 'old-request@example.invalid' }); const previous = f.claim();
  await f.send('email_change', { newEmail: 'new-request@example.invalid' });
  await assert.rejects(f.redeem(previous)); assert.equal(f.user.email, 'guest@example.invalid');
  assert.equal(f.actions[1].completed_at, null);
});
