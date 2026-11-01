import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as routing from '../src/lib/dancr/email-routing.ts';

test('aliases distinguish sending purpose and direct human replies to the right inbox', () => {
  for (const [category, local] of Object.entries({ account: 'no-reply', notification: 'notifications', support: 'support', approvals: 'approvals', safety: 'safety', dmca: 'dmca', billing: 'billing', operations: 'ops', marketing: 'updates' })) {
    const headers = routing.emailHeaders(category);
    assert.equal(headers.from, `MyDancr <${local}@mydancr.com>`);
    assert.equal(headers.reply_to, `${['account', 'notification', 'marketing'].includes(category) ? 'support' : local}@mydancr.com`);
  }
  assert.equal(routing.emailHeaders('support', 'requester@example.invalid').reply_to, 'requester@example.invalid');
});

test('overloaded support notifications keep VIP/table/shift mail separate from support and copyright', () => {
  for (const kind of ['vip_request', 'vip_request_updated', 'internal_table_request', 'dancer_table_request', 'club_pickup']) {
    assert.equal(routing.notificationEmailCategory({ notification_type: 'support_message', payload: { kind } }), 'notification');
  }
  assert.equal(routing.notificationEmailCategory({ notification_type: 'support_message', payload: { threadId: 'thread' } }), 'support');
  assert.equal(routing.notificationEmailCategory({ notification_type: 'dmca_status' }), 'dmca');
  assert.equal(routing.adminReviewEmailCategory('copyright_case'), 'dmca');
  assert.equal(routing.adminReviewEmailCategory('compliance_case'), 'safety');
  assert.equal(routing.adminReviewEmailCategory('content_report'), 'safety');
  for (const kind of ['club_application', 'deal_request', 'page_changes', 'media_approval']) assert.equal(routing.adminReviewEmailCategory(kind), 'approvals');
});

test('transactional requests preserve explicit reply-to and send private links only to their recipient', async () => {
  const requests = [], exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/dancr/notification-delivery.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, AbortSignal, console, process: { env: { RESEND_API_KEY: 'synthetic', EMAIL_FROM: 'legacy@example.invalid' } },
    require: name => name === './email-routing' ? routing : {},
    fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); },
  });
  await exports.sendTransactionalEmail({ category: 'account', to: 'member@example.invalid', subject: 'Setup', text: 'PRIVATE_LINK' });
  await exports.sendTransactionalEmail({ category: 'support', to: 'support@mydancr.com', replyTo: 'requester@example.invalid', subject: 'Recovery', text: 'Reference' });
  await exports.sendTransactionalEmail({ category: 'dmca', to: 'claimant@example.invalid', subject: 'Case', text: 'Reference' });
  assert.equal(requests[0].from, 'MyDancr <no-reply@mydancr.com>');
  assert.equal(requests[0].to, 'member@example.invalid');
  assert.equal(requests[0].reply_to, 'support@mydancr.com');
  assert.equal(requests[1].reply_to, 'requester@example.invalid');
  assert.equal(requests[2].reply_to, 'dmca@mydancr.com');
  for (const body of requests) { assert.equal(body.cc, undefined); assert.equal(body.bcc, undefined); }
});
