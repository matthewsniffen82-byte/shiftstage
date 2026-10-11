import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';
import { notificationIconName } from '../src/lib/dancr/notification-icon.ts';
import * as venuePreferences from '../src/lib/dancr/venue-notification-preferences.ts';

test('edited VIP request alerts honor venue preferences and link to the venue request inbox', async () => {
  const pushes = [], emails = [];
  const row = { recipient_id: 'venue-owner', notification_type: 'support_message', title: 'VIP request updated', body: 'A pending request changed.', payload: { kind: 'vip_request_updated' } };
  let muted = false;
  const client = { auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: venuePreferences.venueNotificationMetadataPatch({ vipRequests: !muted, emailEnabled: true, pushEnabled: true }) } } }) } },
    from() { const query = { select() { return query; }, in() { return query; }, eq: async () => ({ data: [{ id: 'venue-owner', email: 'owner@example.test', role: 'venue' }] }) }; return query; } };
  const delivery = compileVip('src/lib/dancr/notification-delivery.ts', {
    './public-app-url': { publicAppUrl: () => 'https://example.test' },
    './web-push-delivery': { deliverWebPush: async (_client, _recipient, message) => { pushes.push(message); return true; } },
    './customer-notification-preferences': { followAlertKey: () => null },
    './venue-notification-preferences': venuePreferences,
  }, { process: { env: { RESEND_API_KEY: 'synthetic', EMAIL_FROM: 'alerts@example.test' } }, AbortSignal,
    fetch: async (_url, init) => { emails.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); } });
  assert.deepEqual(JSON.parse(JSON.stringify(await delivery.deliverNotificationRows(client, [row]))), { push: 1, email: 1 });
  assert.equal(pushes[0].url, 'https://example.test/dashboard/venue#venue-vip');
  assert.match(emails[0].text, /https:\/\/example.test\/dashboard\/venue#venue-vip/);
  assert.equal(notificationIconName(row), 'calendar');
  muted = true;
  assert.deepEqual(JSON.parse(JSON.stringify(await delivery.deliverNotificationRows(client, [row]))), { push: 0, email: 0 });
  assert.equal(pushes.length, 1); assert.equal(emails.length, 1);
});

test('anonymous VIP alerts reach the dancer inbox, email and push with a dancer dashboard destination', async () => {
  const push = [], emails = [];
  const row = { id: 'notice', recipient_id: 'dancer-user', notification_type: 'support_message',
    title: 'New VIP request', body: 'A VIP requested you at Private club on Jan 15, 2027 20:30 (America/Los_Angeles). Awaiting venue confirmation.',
    payload: { kind: 'vip_dancer_request', venueId: 'venue', venueName: 'Private club', startsAt: '2027-01-16T04:30:00Z', timezone: 'America/Los_Angeles', url: '/dashboard/dancer#dancer-account' } };
  const client = { from(table) {
    const query = { select() { return query; }, in(key, ids) { assert.deepEqual([...ids], ['dancer-user']); return query; },
      eq(key, value) { assert.equal(value, table === 'app_users' ? 'active' : 'dancer-user'); return query; },
      or() { return query; }, order() { return query; }, limit() { return query; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'notifications' ? [row] : [{ id: 'dancer-user', email: 'dancer@example.test', role: 'dancer' }] }).then(resolve, reject); } };
    return query;
  } };
  const delivery = compileVip('src/lib/dancr/notification-delivery.ts', {
    './public-app-url': { publicAppUrl: () => 'https://example.test' },
    './web-push-delivery': { deliverWebPush: async (_client, recipient, message) => { push.push({ recipient, message }); return true; } },
    './customer-notification-preferences': { followAlertKey: () => null },
  }, { process: { env: { RESEND_API_KEY: 'synthetic', EMAIL_FROM: 'alerts@example.test' } }, AbortSignal,
    fetch: async (url, init) => { assert.equal(url, 'https://api.resend.com/emails'); emails.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); } });
  const result = await delivery.deliverNotificationRows(client, [row]);
  assert.equal(result.push, 1); assert.equal(result.email, 1);
  assert.equal(push[0].recipient, row.recipient_id); assert.equal(push[0].message.body, row.body);
  assert.equal(push[0].message.url, 'https://example.test/dashboard/dancer#dancer-account');
  assert.equal(emails[0].to, 'dancer@example.test'); assert.ok(emails[0].text.startsWith(row.body));
  assert.match(emails[0].html, /https:\/\/example.test\/dashboard\/dancer#dancer-account/);
  assert.doesNotMatch(JSON.stringify({ push, emails }), /dashboard\/venue|venue-vip/);
  const inbox = compileVip('src/lib/dancr/notifications.ts', { './notification-icon': { notificationIconName } });
  const notices = await inbox.getUserNotifications(client, 'dancer-user');
  assert.equal(notices.length, 1); assert.equal(notices[0].body, row.body);
  assert.equal(notices[0].icon, 'calendar'); assert.deepEqual(notices[0].payload, row.payload);
});
