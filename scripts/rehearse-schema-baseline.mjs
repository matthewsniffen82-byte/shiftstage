import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { baselineDigest, normalizeBaselineCatalog } from './lib/schema-baseline.mjs';

// This rehearsal is deliberately restricted to the designated recovery project.
const recoveryProject = 'cwpsrrjhrkedwtyatntv';
assert.equal(process.argv[2], recoveryProject, 'Pass the designated recovery project reference');
const root = fileURLToPath(new URL('../', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'dancr-baseline-rehearsal-'));
const receiptPath = resolve(process.argv[3] || join(work, 'receipt.json'));
const cli = process.env.SUPABASE_CLI_PATH || 'supabase';
const directory = join(root, 'supabase/baselines');
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
const baseline = readFileSync(join(directory, manifest.baseline), 'utf8');
const catalog = readFileSync(join(directory, 'catalog.sql'), 'utf8');
assert.equal(baselineDigest(baseline), manifest.baselineSha256);
assert.equal(baselineDigest(catalog), manifest.catalogQuerySha256);
const capture = catalog.slice(catalog.indexOf('select jsonb_build_object('), catalog.lastIndexOf('\nrollback;')).trim().replace(/;$/, '');
assert.ok(capture.startsWith('select jsonb_build_object('));
function query(name, sql) {
  const path = join(work, name + '.sql');
  writeFileSync(path, sql);
  const result = spawnSync(cli, ['db', 'query', '--linked', '--project-ref', recoveryProject, '--file', path, '--output', 'json'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 75000, maxBuffer: 30 * 1024 * 1024 });
  writeFileSync(join(work, name + '.stderr.txt'), result.stderr || '');
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  writeFileSync(join(work, name + '.json'), result.stdout);
  return JSON.parse(result.stdout).rows[0];
}
const startedAt = new Date().toISOString();
const before = query('before', catalog).replay_schema;
assert.ok(before.relations.length > 0 && before.relations.length < 200);
const q = value => '"' + value.replaceAll('"', '""') + '"';
const signature = value => value.startsWith('public.') ? value : 'public.' + value;
const reset = [];
for (const f of before.functions) if (f.name !== 'rls_auto_enable') reset.push('drop function if exists ' + signature(f.signature) + ' cascade;');
for (const relation of before.relations.filter(row => row.kind === 'v')) reset.push('drop view if exists public.' + q(relation.name) + ' cascade;');
for (const relation of before.relations.filter(row => row.kind === 'r')) reset.push('drop table if exists public.' + q(relation.name) + ' cascade;');
for (const e of before.enums) reset.push('drop type if exists public.' + q(e.name) + ' cascade;');
for (const p of before.policies.filter(row => row.schemaname === 'storage')) reset.push('drop policy if exists ' + q(p.policyname) + ' on storage.' + q(p.tablename) + ';');
const ddl = reset.join('\n') + '\n' + baseline.replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '');
const quote = value => { const tag = '$baseline_' + baselineDigest(value).slice(0, 16) + '$'; assert.ok(!value.includes(tag)); return tag + value + tag; };
const sql = [
  'begin; set local search_path=pg_catalog,public,pg_temp; set local lock_timeout=\'3s\'; set local statement_timeout=\'60s\';',
  'create temporary table baseline_result(before_state jsonb,after_state jsonb,error jsonb) on commit drop;',
  'do $rehearsal$ declare original jsonb; rebuilt jsonb; failure jsonb; message text; code text; begin',
  'execute ' + quote(capture) + ' into original;',
  'begin execute ' + quote(ddl) + '; execute ' + quote(capture) + ' into rebuilt;',
  'exception when others then get stacked diagnostics message=message_text,code=returned_sqlstate; failure=jsonb_build_object(\'message\',message,\'code\',code); end;',
  'insert into baseline_result values(original,rebuilt,failure); end $rehearsal$;',
  'select * from baseline_result; rollback;'
].join('\n');
const result = query('rehearsal', sql);
const restored = query('restored', catalog).replay_schema;
const digest = value => baselineDigest(normalizeBaselineCatalog(value));
const actualHash = result.after_state ? digest(result.after_state) : null;
const receipt = {
  format: 1, project: recoveryProject, startedAt, completedAt: new Date().toISOString(),
  baselineSha256: manifest.baselineSha256, catalogQuerySha256: manifest.catalogQuerySha256,
  expectedCatalogSha256: manifest.catalogSha256, actualCatalogSha256: actualHash,
  rebuilt: !result.error, equivalent: actualHash === manifest.catalogSha256,
  rollbackVerified: digest(restored) === digest(before), ledgerPreserved: baselineDigest(restored.ledger) === baselineDigest(before.ledger),
  recreatedRelations: result.after_state?.relations.filter(row => before.relations.some(old => old.name === row.name && old.object_oid !== row.object_oid)).length || 0,
  error: result.error, transactionCommitted: false
};
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...receipt, receiptPath, diagnosticsDirectory: work }, null, 2));
if (!receipt.rebuilt || !receipt.equivalent || !receipt.rollbackVerified || !receipt.ledgerPreserved) process.exitCode = 1;
