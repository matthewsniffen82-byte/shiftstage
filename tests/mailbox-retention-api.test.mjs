import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const load = (file, deps) => { const exports = {}; vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, console, fetch, require: name => { assert.ok(name in deps, name); return deps[name]; } }); return exports; };
test('cron requires secret before any configuration/database access; unconnected and paused do not call Zoho', async () => {
  for (const state of ['unauthorized', 'unconnected', 'paused', 'enabled', 'failure']) {
    let accessed = false, provider = false;
    const q = { select: () => q, eq: () => q, single: async () => ({ data: { enabled: state !== 'paused' } }) };
    const route = load('app/api/cron/mailbox-retention/route.ts', {
      'next/server': require('next/server'), '@/src/lib/dancr/cron-auth': { authorizeCronRequest: () => state === 'unauthorized' ? Response.json({}, { status: 401 }) : null },
      '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => { accessed = true; return { from: () => q }; } },
      '@/src/lib/dancr/zoho-mailbox.mjs': { zohoMailboxConfig: () => { assert.notEqual(state, 'unauthorized'); return state === 'unconnected' ? null : {}; }, createZohoMailbox: async () => { provider = true; return {}; }, processMailboxRetention: async () => ({ failed: state === 'failure' ? 1 : 0 }) },
    });
    const result = await route.GET(new Request('https://fixture.invalid/cron'));
    assert.equal(result.status, state === 'unauthorized' ? 401 : state === 'failure' ? 503 : 200);
    assert.equal(accessed, !['unauthorized', 'unconnected'].includes(state)); assert.equal(provider, ['enabled', 'failure'].includes(state));
  }
});
test('owner authorization happens before mailbox access or privileged database creation', async () => {
  const route = load('app/api/admin/mailbox-retention/route.ts', {
    'next/server': require('next/server'), '@/src/lib/api': { apiError: () => Response.json({}, { status: 403 }) },
    '@/src/lib/api-error-policy': {}, '@/src/lib/bounded-json-body': { readBoundedJsonObject: () => assert.fail('body not reached') },
    '@/src/lib/dancr/admin': { requireAdmin: async (_client, _id, scope) => { assert.equal(scope, 'owner'); throw Error('denied'); } },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ user: { id: 'fixture' } }) },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => assert.fail('database not reached') },
    '@/src/lib/dancr/zoho-mailbox.mjs': { zohoMailboxConfig: () => assert.fail('configuration not reached') },
  });
  for (const action of ['GET', 'POST']) assert.equal((await route[action](new Request('https://fixture.invalid/admin'))).status, 403);
});
test('scheduling accepts only owner-confirmed messages freshly found for an eligible case', async () => {
  const caseId = '10000000-0000-4000-8000-000000000001';
  for (const scenario of ['unconnected', 'open', 'unconfirmed', 'forged', 'valid']) {
    const calls = [];
    const body = { action: 'schedule', source: 'content_reports', caseId, confirmed: scenario !== 'unconfirmed', messageIds: [scenario === 'forged' ? '999' : '123'] };
    class PublicApiError extends Error { constructor(_code, message, status) { super(message); this.status = status; } }
    const route = load('app/api/admin/mailbox-retention/route.ts', {
      'next/server': require('next/server'), '@/src/lib/api': { apiError: e => Response.json({}, { status: e.status || 500 }) },
      '@/src/lib/api-error-policy': { PublicApiError }, '@/src/lib/bounded-json-body': { readBoundedJsonObject: async () => body },
      '@/src/lib/dancr/admin': { requireAdmin: async () => {} },
      '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ user: { id: 'owner' } }) },
      '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'mailbox_case_context' ? scenario === 'open' ? null : { closedAt: '2020-01-01' } : ['job'] }; } }) },
      '@/src/lib/dancr/zoho-mailbox.mjs': { zohoMailboxConfig: () => scenario === 'unconnected' ? null : {}, createZohoMailbox: async () => ({ accountId: '100', searchCase: async phrase => { assert.equal(phrase, caseId); return [{ messageId: '123', folderId: '200' }]; } }) },
    });
    const result = await route.POST(new Request('https://fixture.invalid/admin'));
    assert.equal(result.status, scenario === 'valid' ? 200 : 400);
    const enrollment = calls.find(c => c.name === 'enroll_mailbox_retention');
    assert.equal(!!enrollment, scenario === 'valid');
    if (enrollment) { assert.equal(enrollment.args.p_actor, 'owner'); assert.equal(enrollment.args.p_messages[0].folderId, '200'); assert.equal(enrollment.args.p_account, '100'); }
  }
});
