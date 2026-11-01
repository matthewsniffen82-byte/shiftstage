import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('retired photo analysis cannot initialize a provider or database, even for an authorized caller', async () => {
  const exports = {}; let denied = true;
  const source = readFileSync(new URL('../app/api/cron/main-photo-analysis/route.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } };
      if (name === '@/src/lib/dancr/cron-auth') return { authorizeCronRequest: () => denied ? new Response(null, { status: 401 }) : null };
      assert.fail('Retired endpoint must not import provider, image or database code: ' + name);
    },
  });
  assert.equal((await exports.GET({})).status, 401);
  denied = false;
  const response = await exports.GET({});
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { ok: false, status: 'retired' });
  const crons = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons;
  assert.ok(!crons.some(job => job.path === '/api/cron/main-photo-analysis'));
});
