import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('app/api/admin/workspace/summary/route.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

test('the overdue badge totals the same two staff queues as Approvals', async () => {
  const calls = [], exports = {};
  let batchCount = 0, standaloneCount = 0;
  const db = {
    rpc(name, args) {
      calls.push({ name, args });
      return { data: name === 'get_media_batches_page' ? { count: args.p_hours ? batchCount : 7 }
        : { total: standaloneCount, counts: { staff: 4 } }, error: null };
    },
    from() {
      const chain = new Proxy({}, { get(_, method) {
        if (method === 'then') return resolve => resolve({ count: 0, error: null });
        return () => chain;
      } });
      return chain;
    },
  };
  const modules = {
    'next/server': { NextResponse: { json: value => value } },
    '@/src/lib/api': { apiError: error => { throw error; } },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: () => ({ user: { id: 'owner' } }) },
    '@/src/lib/dancr/admin': { requireAdmin: () => {} },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => db },
  };
  vm.runInNewContext(compiled, { exports, require: name => modules[name] });
  assert.equal((await exports.GET({})).overdue, 0);
  batchCount = 2; standaloneCount = 1;
  const summary = await exports.GET({});
  assert.equal(summary.ready, 11);
  assert.equal(summary.overdue, 3);
  assert.ok(calls.every(({ args }) => args.p_actor === 'owner' && args.p_counts_only === true));
  const aged = calls.filter(({ args }) => args.p_hours === 24);
  assert.ok(aged.some(({ name, args }) => name === 'get_media_batches_page' && args.p_role === 'admin' && args.p_venue === null));
  assert.ok(aged.some(({ name, args }) => name === 'get_admin_media_dancers' && args.p_stage === 'staff' && args.p_venue_id === null));
});
