import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as serverJob from '../src/lib/server-job.ts';
import { venueNotificationSettings, venueNotificationMetadataPatch } from '../src/lib/dancr/venue-notification-preferences.ts';

const compile = path => ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture({ configured = true, preferences = { emailEnabled: true }, sent = 1, fail = false, authError = false, receipt = true, event, deadline } = {}) {
  const service = {}, calls = [], deliveries = []; let claimed = false;
  vm.runInNewContext(compile('src/lib/dancr/internal-request-email.ts'), {
    exports: service, performance, console: { warn() {} },
    process: { env: configured ? { RESEND_API_KEY: 'synthetic', EMAIL_FROM: 'test@example.invalid' } : {} },
    require: name => ({
      'server-only': {}, '../server-job': serverJob, './venue-notification-preferences': { venueNotificationSettings },
      './notification-delivery': { deliverNotificationRows: async (_client, rows, options) => {
        deliveries.push({ rows, options }); if (fail) throw Error('provider unavailable');
        return { email: sent, push: 0 };
      } },
    }[name]),
  });
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'claim_internal_request_emails') {
        const jobs = claimed ? [] : [{ id: 'delivery-id', lease_id: 'lease-id', recipient_id: 'manager-id', table_label: 'Table 12', stage_name: 'Star', venue_name: 'Rhino', event_kind: event || 'requested' }];
        claimed = true; return { data: jobs, error: null };
      }
      return { data: receipt, error: null };
    },
    auth: { admin: { getUserById: async () => authError ? { data: {}, error: Error('unavailable') }
      : { data: { user: { user_metadata: venueNotificationMetadataPatch(preferences) } }, error: null } } },
  };
  return { calls, deliveries, run: () => service.deliverInternalRequestEmail(client, 'request-id', { event, deadline }) };
}

test('venue email sends independently of browser enrollment and contains the exact table, dancer and club', async () => {
  const f = fixture({ preferences: { emailEnabled: true, pushEnabled: false } });
  assert.equal((await f.run()).sent, 1);
  const { rows, options } = f.deliveries[0];
  assert.equal(options.email, true); assert.equal(options.push, false);
  assert.equal(rows[0].recipient_id, 'manager-id'); assert.equal(rows[0].deliveryId, 'delivery-id');
  assert.match(rows[0].body, /Table 12 at Rhino requested Star/);
  assert.equal(rows[0].payload.kind, 'internal_table_request');
  assert.equal(f.calls[0].args.p_request_id, 'request-id');
});
test('cancellation sends its own email wording and event', async () => {
  const f = fixture({ event: 'cancelled' }); await f.run();
  assert.equal(f.calls[0].args.p_event_kind, 'cancelled');
  assert.equal(f.deliveries[0].rows[0].title, 'Table request cancelled');
  assert.equal(f.deliveries[0].rows[0].payload.event, 'cancelled');
  assert.match(f.deliveries[0].rows[0].body, /cancelled the request for Star/);
});
for (const key of ['emailEnabled', 'tableRequests', 'alertsEnabled']) test(key + ' opt-out still suppresses venue email', async () => {
  const f = fixture({ preferences: { emailEnabled: true, [key]: false } });
  assert.equal((await f.run()).skipped, 1); assert.equal(f.deliveries.length, 0);
});
for (const options of [{ configured: false }, { deadline: performance.now() + 1000 }]) test('missing email configuration or short budget leaves jobs pending', async () => {
  const f = fixture(options); await f.run(); assert.equal(f.calls.length, 0);
});
for (const options of [{ sent: 0 }, { fail: true }, { authError: true }]) test('failed or unconfirmed email delivery retries instead of marking sent', async () => {
  const f = fixture(options); assert.equal((await f.run()).retry, 1);
  assert.equal(f.calls.find(call => call.name === 'finish_internal_request_email').args.p_outcome, 'retry');
});
test('unconfirmed receipt reports failure for recovery', async () => {
  await assert.rejects(fixture({ receipt: false }).run(), /acknowledgement/);
});
test('cancellation dispatcher settles both venue channels without sending a new dancer request alert', async () => {
  const service = {}, calls = [];
  vm.runInNewContext(compile('src/lib/dancr/internal-request-alerts.ts'), { exports: service, require: name => ({
    'server-only': {},
    './internal-request-push': { deliverInternalRequestPush: async (_client, request, options) => {
      calls.push(['push', request, options.event]); throw Error('push unavailable');
    } },
    './internal-request-email': { deliverInternalRequestEmail: async (_client, request, options) => {
      calls.push(['email', request, options.event]); return { configured: true, sent: 1, skipped: 0, retry: 0 };
    } },
    './dancer-table-request-alerts': { deliverDancerTableRequestAlerts: async () => { calls.push(['dancer']); } },
  }[name]) });
  await assert.rejects(service.deliverInternalRequestAlerts({}, 'request-id', { event: 'cancelled' }), /push unavailable/);
  assert.deepEqual(calls, [['push', 'request-id', 'cancelled'], ['email', 'request-id', 'cancelled']]);
});
