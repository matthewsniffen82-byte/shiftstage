import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as links from '../src/lib/dancr/admin-review-email-links.ts';
import { adminSectionForPanel } from '../app/admin/admin-section-navigation.ts';

const env = { RESEND_API_KEY: 'synthetic-key', EMAIL_FROM: 'test@example.invalid' };
function compile(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, performance, AbortSignal, Response, Request, URL, console, process: { env }, require: n => deps[n] || {}, ...globals });
  return exports;
}
const target = { email: 'owner@example.invalid', kind: 'media_approval', title: 'Photo awaiting approval', body: 'A <dancer> has club-approved media.', sourceId: 'photo-reference' };
function fixture({ response = () => Response.json({ id: 'provider-id' }), configured = true, allowed = true, receipt = true, targetError = false } = {}) {
  const requests = [], calls = []; let claimed = false;
  const service = compile('src/lib/dancr/admin-review-email-delivery.ts', {
    './public-app-url': { publicAppUrl: () => 'https://example.invalid' }, './admin-review-email-links': links,
  }, { process: { env: configured ? env : {} }, fetch: async (url, init) => { requests.push({ url, init }); return response(); } });
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'claim_admin_review_emails') { const jobs = claimed ? [] : [{ id: 'job-1', lease_id: 'lease-1' }]; claimed = true; return { data: jobs }; }
    if (name === 'admin_review_email_target') return targetError ? { error: Error('database unavailable') } : { data: allowed ? target : null };
    if (name === 'finish_admin_review_email') return { data: receipt };
    throw Error(`Unexpected RPC ${name}`);
  } };
  return { service, requests, calls, run: () => service.deliverAdminReviewEmails(client) };
}

test('review and compliance email categories open their authorized admin queue and reject arbitrary destinations', () => {
  for (const [kind, workspace, section] of [
    ['club_application', 'clubs', 'requests'], ['deal_request', 'clubs', 'requests'], ['page_changes', 'clubs', 'requests'],
    ['content_report', 'approvals', 'reports'], ['copyright_case', 'more', 'platform'], ['media_approval', 'approvals', 'media'], ['compliance_case', 'more', 'compliance'],
  ]) {
    const destination = links.adminReviewEmailDestination(kind);
    assert.equal(destination.workspace, workspace);
    assert.equal(adminSectionForPanel(workspace, destination.panel), section);
    assert.equal(links.adminReviewEmailPath(kind), `/admin?alert=${kind}`);
  }
  for (const kind of ['https://attacker.invalid', '//attacker.invalid', '__proto__', 'constructor', null]) {
    assert.equal(links.adminReviewEmailDestination(kind), null);
    assert.equal(links.adminReviewEmailPath(kind), '/admin');
  }
});

test('media emails use the verified destination, escaped content and the same provider key across retries', async () => {
  const f = fixture(); assert.equal((await f.run()).accepted, 1);
  await f.service.sendAdminReviewEmail({ id: 'job-1', lease_id: 'lease-2' }, target);
  const { url, init } = f.requests[0];
  assert.equal(url, 'https://api.resend.com/emails'); assert.equal(init.redirect, 'error');
  assert.equal(init.headers['Idempotency-Key'], 'admin-review-email/job-1');
  assert.equal(f.requests[1].init.body, init.body);
  assert.equal(f.requests[1].init.headers['Idempotency-Key'], init.headers['Idempotency-Key']);
  const body = JSON.parse(init.body); assert.deepEqual(body.to, [target.email]);
  assert.match(body.html, /&lt;dancer&gt;/); assert.doesNotMatch(body.html, /<dancer>/);
  assert.match(body.text, /https:\/\/example.invalid\/admin\?alert=media_approval$/);
  assert.equal(f.calls.find(x => x.name === 'finish_admin_review_email').args.p_provider_id, 'provider-id');
});

test('outages, throttling and uncertain acceptance retry while permanent rejection is recorded', async () => {
  for (const response of [() => new Response('', { status: 429 }), () => new Response('', { status: 503 }), () => { throw Error('timeout'); }, () => Response.json({})]) {
    const f = fixture({ response }); assert.equal((await f.run()).retry, 1);
    assert.equal(f.calls.find(x => x.name === 'finish_admin_review_email').args.p_status, 'retry');
  }
  const f = fixture({ response: () => new Response('', { status: 403 }) });
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.calls.find(x => x.name === 'finish_admin_review_email').args.p_outcome, 'provider_403');
});

test('missing provider configuration leaves queued alerts untouched', async () => {
  const f = fixture({ configured: false }); assert.equal((await f.run()).configured, false);
  assert.equal(f.calls.length, 0); assert.equal(f.requests.length, 0);
});

test('changed access skips email, lookup failures retry and missing receipts fail visibly', async () => {
  const f = fixture({ allowed: false }); assert.equal((await f.run()).skipped, 1); assert.equal(f.requests.length, 0);
  assert.equal((await fixture({ targetError: true }).run()).retry, 1);
  await assert.rejects(fixture({ receipt: false }).run(), /receipt/);
});

test('the cron route authorizes before work and reports configuration or delivery failures', async () => {
  for (const [authorized, result, expected] of [[false, {}, 401], [true, { configured: false, failed: 0 }, 503], [true, { configured: true, failed: 1 }, 503], [true, { configured: true, failed: 0 }, 200]]) {
    let deliveries = 0, enqueued = 0;
    const route = compile('app/api/cron/admin-review-emails/route.ts', {
      'next/server': { NextResponse: Response },
      '@/src/lib/dancr/cron-auth': { authorizeCronRequest: () => authorized ? null : new Response('', { status: 401 }) },
      '@/src/lib/dancr/admin-review-email-delivery': { deliverAdminReviewEmails: async () => { deliveries++; return result; } },
      '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ rpc: async name => { assert.equal(name, 'enqueue_case_alerts'); enqueued++; return { error: null }; } }) },
      '@/src/lib/server-job': { runWithServerJob: task => task() },
    });
    const response = await route.GET(new Request('https://example.invalid/api/cron/admin-review-emails'));
    assert.equal(response.status, expected); assert.equal(deliveries, authorized ? 1 : 0);
    assert.equal(enqueued, authorized ? 1 : 0);
    if (authorized) assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
