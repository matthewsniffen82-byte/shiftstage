import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import { accountActionEmailHtml } from '../src/lib/dancr/account-action-email.ts';

// Route/service integration with synthetic database, Auth and email providers.
// No browser, live accounts or external requests.
class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
const guestId = '97000000-0000-4000-8000-000000000001';
const venueId = '97000000-0000-4000-8000-000000000020';
const venueName = 'Echo <House> & Friends';
const email = 'guest@example.test';
const week = 7 * 86400000;
const vip = compileVip('src/lib/dancr/vip.ts', { '../api-error-policy': { PublicApiError } });
const milestones = compileVip('src/lib/dancr/password-setup.ts');

function fixture({ existing = false, role = 'customer', active = true, delivered = true, denied = false } = {}) {
  let user = existing ? { id: guestId, email, email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: { role }, app_metadata: {} } : null;
  const invitations = [], emails = [], calls = [];
  const account = () => user ? { id: guestId, email, role, accountState: active ? 'active' : 'disabled' } : null;
  const admin = {
    from: table => {
      const filters = [];
      const chain = { select: () => chain, eq: (key, value) => { filters.push(row => row[key] === value); return chain; },
        is: (key, value) => { filters.push(row => row[key] === value); return chain; },
        or: predicate => {
          const prefix = 'expires_at.is.null,expires_at.gt.';
          assert.ok(predicate.startsWith(prefix));
          const now = Date.parse(predicate.slice(prefix.length));
          assert.ok(Number.isFinite(now));
          filters.push(row => row.expires_at === null || Date.parse(row.expires_at) > now);
          return chain;
        },
        maybeSingle: async () => ({ data: (table === 'app_users' ? user ? [{ id: guestId, email, role, account_state: active ? 'active' : 'disabled' }] : [] : invitations).find(row => filters.every(filter => filter(row))) || null }),
      }; return chain;
    },
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]); assert.equal(name, 'vip_manage'); assert.equal(args.p_venue, venueId);
      for (const row of invitations) row.revoked_at = new Date().toISOString();
      const row = { id: '97000000-0000-4000-8000-' + String(invitations.length + 100).padStart(12, '0'), venue_id: venueId,
        email: args.p_data.email, token_digest: args.p_data.digest, accepted_at: null, revoked_at: null, expires_at: new Date(Date.now() + week).toISOString(),
        venue: { name: venueName, is_active: true, owner: { role: 'venue', account_state: 'active' } } };
      invitations.push(row); return { data: { id: row.id } };
    },
    auth: { admin: {
      getUserById: async id => { assert.equal(id, guestId); calls.push(['getUser']); return { data: { user } }; },
      generateLink: async input => {
        calls.push(['generate', input]); assert.equal(input.email, email); assert.equal(input.type, 'magiclink');
        if (!user) user = { id: guestId, email, email_confirmed_at: null, user_metadata: input.options.data, app_metadata: {} };
        return { data: { user, properties: { hashed_token: 'synthetic-email-proof' } } };
      },
    } },
  };
  const service = compileVip('src/lib/dancr/vip-setup-link.ts', {
    '../server-env': { getOptionalServerEnv: () => null, getServerEnv: () => 'synthetic-signing-key' },
    '../api-error-policy': { PublicApiError }, './vip': vip, './password-setup': milestones,
    './auth': { getAccountByUserId: async () => account() },
    './account-profile-recovery': { recoverVerifiedPublicAccount: async () => account() },
    './public-app-url': { publicAppUrl: () => 'https://mydancr.test' },
    './account-action-email': { accountActionEmailHtml },
    './notification-delivery': { sendTransactionalEmail: async input => { emails.push(input); return { delivered }; } },
    '../supabase/server': { createServerSupabaseClient: () => ({ auth: {
      verifyOtp: async input => { calls.push(['verify', input]); user.email_confirmed_at = new Date().toISOString(); return { data: { user, session: { access_token: 'verified-access', refresh_token: 'verified-refresh' } } }; },
      signOut: async () => { calls.push(['signOut']); },
    } }) },
  }, { Buffer });
  const route = compileVip('app/api/venue/vip/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/api': { PublicApiError, apiError: error => Response.json({ ok: false, error: error.message }, { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject: async request => request.json() },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => { if (denied) throw new PublicApiError('FORBIDDEN', 'Denied', 403); return { user: { id: 'manager' }, session: { accessToken: 'manager-session' } }; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/src/lib/dancr/vip': { ...vip, requireVipManager: async () => ({ venueId, venueName }) },
    '@/src/lib/dancr/vip-setup-link': service,
    '@/src/lib/dancr/public-app-url': { publicAppUrl: () => 'https://mydancr.test' },
    '@/src/lib/dancr/notification-delivery': { deliverNotificationRows: async () => {} },
  }, { Response, Request });
  return { emails, calls, invitations, service, user: () => user,
    post: async (body = {}) => { const response = await route.POST(new Request('https://mydancr.test/api/venue/vip', { method: 'POST', body: JSON.stringify({ action: 'invite', email, ...body }) })); return { response, data: await response.json() }; },
    claim: (index = 0) => service.readVipSetupToken(new URLSearchParams(new URL(emails[index].text.match(/https:\/\/\S+/)[0]).hash.slice(1)).get('link')),
    redeem: claim => service.redeemVipSetupLink(admin, claim),
  };
}

test('the venue first email itself confirms the guest and opens password creation without a second email', async () => {
  const f = fixture(); const { response, data } = await f.post({ role: 'admin', userTermsAccepted: true, password: 'Never-set-by-manager' });
  assert.equal(response.status, 200); assert.equal(data.emailDelivered, true); assert.equal(f.emails.length, 1);
  const mail = f.emails[0], url = new URL(mail.text.match(/https:\/\/\S+/)[0]);
  assert.equal(url.pathname, '/auth/vip-setup');
  assert.ok(mail.html.startsWith('<p>Echo &lt;House&gt; &amp; Friends invited you to MyDancr VIP.'));
  assert.ok(mail.html.includes(`</p><p><a href="${url.href}">Confirm email</a></p>`));
  assert.doesNotMatch(mail.html, /<h[1-6]\b|style=|<button\b/i);
  assert.equal(mail.to, email);
  assert.match(mail.text, /email will already be filled in/); assert.match(mail.text, /click Create account/);
  assert.equal(JSON.stringify(data).includes('vips_'), false); assert.notEqual(data.invitationUrl, url.href);
  const claim = f.claim(); assert.equal(claim.invitation, new URL(data.invitationUrl).pathname.split('/').pop());
  assert.equal(claim.expiresAt, null); // The current invitation record controls expiry.
  const identity = f.calls.find(c => c[0] === 'generate')[1];
  assert.equal(identity.password, undefined); assert.equal(identity.options.data.role, 'customer');
  assert.equal(identity.options.data.user_terms_intent, undefined); // A manager cannot accept terms for the guest.
  assert.equal(f.user().email_confirmed_at, null); assert.deepEqual(f.user().app_metadata, {});
  const result = await f.redeem(claim);
  assert.equal(result.complete, false); assert.equal(result.account.email, email);
  assert.equal(result.session.accessToken, 'verified-access'); assert.equal(result.returnTo, '/vip/invite/' + claim.invitation);
  assert.ok(f.user().email_confirmed_at); assert.equal(f.emails.length, 1);
  assert.throws(() => f.service.readVipSetupToken(claim.invitation), { status: 404 });
});

test('a returning VIP receives sign-in instructions and the email does not issue a session', async () => {
  const f = fixture({ existing: true });
  f.user().app_metadata = { mydancr_password_setup_completed_at: '2026-10-01', mydancr_password_login_at: '2026-10-02' };
  assert.equal((await f.post()).data.emailDelivered, true);
  assert.match(f.emails[0].text, /sign in with your existing VIP password/);
  assert.match(f.emails[0].html, /<p><a href="[^"]+">Open VIP invitation<\/a><\/p>/);
  assert.doesNotMatch(f.emails[0].html + f.emails[0].text, /Create account|<h[1-6]\b|style=/i);
  const result = await f.redeem(f.claim());
  assert.equal(result.complete, true);
  assert.equal(result.session, undefined);
  assert.match(result.returnTo, /^\/vip\/invite\//);
});

test('resending to an unfinished confirmed guest reuses the account and replaces the previous email credential', async () => {
  const f = fixture({ existing: true }); const first = await f.post(); const original = f.claim();
  assert.equal(f.calls.some(c => c[0] === 'generate'), false);
  await f.redeem(original); await f.redeem(original); // Confirming twice does not finish setup.
  const resent = await f.post({ action: 'resend_invitation', id: first.data.invitationId, email: 'attacker@example.test' });
  assert.equal(resent.data.emailDelivered, true); assert.equal(f.emails[1].to, email);
  assert.equal(f.claim(1).userId, original.userId); assert.notEqual(f.claim(1).invitation, original.invitation);
  await assert.rejects(f.redeem(original), { status: 404 });
  const result = await f.redeem(f.claim(1)); assert.equal(result.account.email, email); assert.equal(result.complete, false);
  assert.equal(f.calls.filter(c => c[0] === 'generate').length, 3); // Only the three Auth exchanges.
});

test('delivery failure, non-guest accounts and denied managers never falsely report a delivered confirmation', async () => {
  const failed = fixture({ delivered: false }); const response = await failed.post();
  assert.equal(response.data.emailDelivered, false); assert.equal(JSON.stringify(response.data).includes('vips_'), false);
  for (const options of [{ existing: true, role: 'venue' }, { existing: true, active: false }]) {
    const f = fixture(options); const result = await f.post(); assert.equal(result.data.emailDelivered, false);
    assert.equal(f.emails.length, 0); assert.equal(f.calls.some(c => c[0] === 'generate'), false);
  }
  const denied = fixture({ denied: true }); assert.equal((await denied.post()).response.status, 403);
  assert.equal(denied.emails.length, 0); assert.equal(denied.calls.length, 0);
});

test('the manager share URL cannot confirm email or create an authenticated guest session', async () => {
  const f = fixture({ existing: true }); const first = await f.post();
  const shared = await f.post({ action: 'share_invitation', id: first.data.invitationId });
  assert.equal(shared.data.emailDelivered, false); assert.equal(f.emails.length, 1);
  assert.match(shared.data.invitationUrl, /\/vip\/invite\/vip_/);
  assert.throws(() => f.service.readVipSetupToken(new URL(shared.data.invitationUrl).pathname.split('/').pop()), { status: 404 });
  assert.equal(f.calls.some(c => c[0] === 'generate'), false);
});
