import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaReplayPlan } from './lib/schema-replay-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.argv[2], 'Provide a new output directory for the isolated replay project');
const output = resolve(process.argv[2]);
const plan = await schemaReplayPlan(root);
// Refuse an existing directory, so a linked production workspace cannot be reused.
await mkdir(output, { recursive: false });
const target = join(output, 'supabase/migrations');
await mkdir(target, { recursive: true });
await copyFile(join(root, 'supabase/baselines', plan.baseline), join(target, plan.baseline));
for (const file of plan.forwardMigrations) await copyFile(join(root, 'supabase/migrations', file), join(target, file));
await writeFile(join(output, 'replay-plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ...plan, note: 'Prepared only. Initialize Supabase configuration here and use a fresh disposable Supabase project. Auth/Storage services and PG17 extensions must already exist. No application data or media are restored.' }, null, 2));
