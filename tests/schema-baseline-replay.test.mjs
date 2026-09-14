import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaReplayPlan } from '../scripts/lib/schema-replay-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'dancr-replay-plan-test-'));
  assert.equal(dirname(path), tmpdir());
  t.after(() => rm(path, { recursive: true, force: true }));
  for (const file of ['supabase', 'scripts/lib/schema-baseline.mjs', 'scripts/rehearse-schema-baseline.mjs']) await cp(join(root, file), join(path, file), { recursive: true });
  return path;
}
test('the checked baseline has two native Postgres reconstruction receipts and excludes legacy history', async () => {
  const plan = await schemaReplayPlan(root);
  assert.equal(plan.baselineReplayReady, true);
  assert.ok(plan.coveredMigrations >= 182);
  assert.equal(plan.baseline, '20260914040900_application.sql');
});
test('changing any covered SQL invalidates the replay plan', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'supabase/migrations/20260914040900_select_due_invoice_reminders.sql'), 'select 1;');
  await assert.rejects(schemaReplayPlan(path), /Covered migration changed/);
});
test('a later migration is included exactly once and still requires validation', async t => {
  const path = await fixture(t);
  const file = '20990914040900_future.sql';
  await writeFile(join(path, 'supabase/migrations', file), 'select 1;');
  const plan = await schemaReplayPlan(path);
  assert.ok(plan.forwardMigrations.includes(file));
  assert.equal(plan.forwardMigrationsRequireValidation, true);
});
test('uncovered old SQL cannot slip into the baseline replay', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'supabase/migrations/20260912040900_uncovered.sql'), 'select 1;');
  await assert.rejects(schemaReplayPlan(path), /precedes the baseline/);
});
test('edited receipts, baseline SQL, and normalization fail closed', async t => {
  for (const file of ['supabase/baselines/rehearsal-1.json', 'supabase/baselines/20260914040900_application.sql', 'scripts/lib/schema-baseline.mjs']) {
    const path = await fixture(t);
    const target = join(path, file);
    await writeFile(target, (await readFile(target, 'utf8')) + '\n');
    await assert.rejects(schemaReplayPlan(path));
  }
});
