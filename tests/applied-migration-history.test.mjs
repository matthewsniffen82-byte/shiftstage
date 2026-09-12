import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const { verifyMigrationHistory } = await import(new URL("scripts/check-supabase-migrations.mjs", root));
const baselineUrl = new URL("supabase/migration-history-baseline.json", root);
const evidenceUrl = new URL("docs/supabase-reliability/step-13-applied-migrations.json", root);

test("already-deployed migrations reject edits that the preceding manifest admitted", async t => {
  const current = JSON.parse(await readFile(baselineUrl, "utf8"));
  const evidence = JSON.parse(await readFile(evidenceUrl, "utf8"));
  // Freeze the regression cohort so future additive migrations do not change
  // the historical negative control or become accidental fixture dependencies.
  const reviewed = { ...current, files: current.files.filter(entry => entry.file.split("_")[0] <= "20260910172000") };
  const preceding = { ...reviewed, files: reviewed.files.filter(entry => entry.file.split("_")[0] <= "20260910050900") };
  assert.equal(preceding.files.length, 142);
  assert.equal(evidence.entries.length, 17);
  assert.equal(reviewed.files.length, 159);
  for (const expected of evidence.entries) {
    assert.deepEqual(reviewed.files.find(entry => entry.file === expected.file), { file: expected.file, sha256: expected.sha256 });
  }

  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, "mydancr-applied-history-"));
  assert.equal(dirname(directory), parent);
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), parent);
    await rm(directory, { recursive: true, force: true });
  });
  await Promise.all(reviewed.files.map(async entry => {
    const sql = await readFile(new URL(`supabase/migrations/${entry.file}`, root), "utf8");
    await writeFile(join(directory, entry.file), sql);
  }));
  const initial = await verifyMigrationHistory(directory, reviewed);
  assert.equal(initial.ok, true, initial.errors.join("\n"));

  for (const entry of evidence.entries) await t.test(entry.file, async () => {
    const path = join(directory, entry.file);
    const original = await readFile(path, "utf8");
    // The altered SQL stays syntactically nonempty with a valid timestamp:
    // the former new-file checks accepted it despite recorded deployment.
    await writeFile(path, `${original}\nselect 1; -- synthetic post-deployment alteration\n`);
    const oldResult = await verifyMigrationHistory(directory, preceding);
    assert.equal(oldResult.ok, true, oldResult.errors.join("\n"));
    const protectedResult = await verifyMigrationHistory(directory, reviewed);
    assert.equal(protectedResult.ok, false);
    assert.ok(protectedResult.errors.includes(`Historical SQL changed: ${entry.file}. Add a new migration instead.`));
    await writeFile(path, original);
  });
});
