import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { migrationDigest, verifyMigrationHistory } from "../scripts/check-supabase-migrations.mjs";

async function fixture(t) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, "mydancr-migration-test-"));
  assert.equal(dirname(directory), parent);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sql = "create table public.example (id uuid primary key);\n";
  const names = ["202606280001_first.sql", "202606280001_second.sql", "202609090003_latest.sql"];
  await Promise.all(names.map(name => writeFile(join(directory, name), sql)));
  const baseline = { format: 1, files: names.map(file => ({ file, sha256: migrationDigest(sql) })) };
  return { directory, baseline, sql, check: () => verifyMigrationHistory(directory, baseline) };
}

test("repository preserves its audited historical migrations", async () => {
  const baseline = JSON.parse(await readFile(new URL("../supabase/migration-history-baseline.json", import.meta.url), "utf8"));
  const report = await verifyMigrationHistory(fileURLToPath(new URL("../supabase/migrations", import.meta.url)), baseline);
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.equal(report.historicalCollisions.length, 4);
});

test("historical collisions are disclosed without pretending they are replayable", async t => {
  const f = await fixture(t);
  const result = await f.check();
  assert.equal(result.ok, true);
  assert.equal(result.historicalCollisions.length, 1);
});

test("new unique timestamped migration is accepted without touching existing SQL", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "20260909123000_new_constraint.sql"), "select 1;\n");
  const result = await f.check();
  assert.equal(result.ok, true);
  assert.equal(result.newFiles, 1);
});

test("editing historical SQL fails, while Windows newline conversion is harmless", async t => {
  const f = await fixture(t);
  const path = join(f.directory, f.baseline.files[0].file);
  await writeFile(path, f.sql.replace(/\n/g, "\r\n"));
  assert.equal((await f.check()).ok, true);
  await writeFile(path, f.sql + "drop table public.example;\n");
  assert.match((await f.check()).errors.join("\n"), /Historical SQL changed/);
});

test("deleting or renaming historical migrations fails", async t => {
  const f = await fixture(t);
  await rename(join(f.directory, f.baseline.files[0].file), join(f.directory, "20260909123000_renamed.sql"));
  assert.match((await f.check()).errors.join("\n"), /missing or renamed/);
});

test("new files cannot join a historical collision or collide with each other", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "202606280001_third.sql"), "select 1;");
  await writeFile(join(f.directory, "20260909123000_one.sql"), "select 1;");
  await writeFile(join(f.directory, "20260909123000_two.sql"), "select 1;");
  const errors = (await f.check()).errors;
  assert.equal(errors.filter(error => error.startsWith("Duplicate migration version")).length, 2);
});

test("new invalid dates, backdated versions, and empty files fail", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "20261301120000_bad_month.sql"), "select 1;");
  await writeFile(join(f.directory, "20260230120000_bad_day.sql"), "select 1;");
  await writeFile(join(f.directory, "20250101120000_backdated.sql"), "select 1;");
  await writeFile(join(f.directory, "20260909123000_empty.sql"), "  \n");
  const errors = (await f.check()).errors.join("\n");
  assert.match(errors, /valid UTC/);
  assert.match(errors, /sorts into historical/);
  assert.match(errors, /Empty migration/);
});

test("missing baseline and unsafe baseline paths fail closed", async t => {
  const f = await fixture(t);
  await assert.rejects(verifyMigrationHistory(f.directory, { format: 1, files: [] }), /Missing migration history baseline/);
  f.baseline.files[0].file = "../outside.sql";
  await assert.rejects(f.check(), /Invalid migration history baseline entry/);
});

test("the build-facing CLI returns failure for historical edits", async t => {
  const f = await fixture(t);
  const scripts = join(f.directory, "scripts");
  const migrations = join(f.directory, "supabase", "migrations");
  await mkdir(scripts);
  await mkdir(migrations, { recursive: true });
  const script = join(scripts, "check-supabase-migrations.mjs");
  await writeFile(script, await readFile(new URL("../scripts/check-supabase-migrations.mjs", import.meta.url)));
  await writeFile(join(f.directory, "supabase", "migration-history-baseline.json"), JSON.stringify(f.baseline));
  await Promise.all(f.baseline.files.map(entry => writeFile(join(migrations, entry.file), f.sql)));
  const run = () => spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 30_000 });
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).replayReady, false);
  await writeFile(join(migrations, f.baseline.files[0].file), "select 2;\n");
  const bad = run();
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(JSON.parse(bad.stdout).errors.join("\n"), /Historical SQL changed/);
});
