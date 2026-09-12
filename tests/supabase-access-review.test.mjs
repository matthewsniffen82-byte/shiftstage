import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reviewSupabaseAccessCatalog } from "../scripts/lib/supabase-access-review.mjs";

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const publicAccess = read("./fixtures/rls-current-access.json");
const storageAccess = read("../docs/supabase-reliability/step-01-inventory.json").catalog;
const expected = { publicAccess, storageAccess };
const catalog = () => structuredClone({
  captured_at: publicAccess.capturedAt, read_only: "on",
  relations: [...publicAccess.relations, ...storageAccess.relations.filter(row => row.schema_name === "storage")],
  policies: [...publicAccess.policies, ...storageAccess.policies.filter(row => row.schemaname === "storage")],
  views: [...publicAccess.views, ...storageAccess.views.filter(row => row.schemaname === "storage")],
  functions: publicAccess.helpers.map(helper => ({ schema_name: "public", name: helper.name, arguments: "", definition_fingerprint: helper.fingerprint })),
  buckets: storageAccess.buckets,
});

test("access review accepts the reviewed metadata without mutating it", () => {
  const input = catalog(), before = structuredClone(input);
  const result = reviewSupabaseAccessCatalog(input, expected);
  assert.equal(result.ok, true);
  assert.deepEqual(input, before);
  for (const key of ["relations", "policies", "views", "functions", "buckets"]) input[key].reverse();
  assert.equal(reviewSupabaseAccessCatalog(input, expected).ok, true);
});

const changes = [
  ["a newly added table requires review", input => input.relations.push({ ...input.relations[0], name: "synthetic_new_table" })],
  ["a missing reviewed table", input => input.relations.shift()],
  ["disabled row security", input => { input.relations[0].rls = false; }],
  ["an added browser read grant", input => { input.relations.find(row => row.name === "gallery_storage_retirements").grants.anon.select = true; }],
  ["service receipt writes", input => { input.relations.find(row => row.name === "gallery_storage_retirements").grants.service_role.update = true; }],
  ["a changed relation owner", input => { input.relations[0].owner = "authenticated"; }],
  ["a changed view security mode", input => { input.relations.find(row => row.kind === "v").options = ["security_invoker=false"]; }],
  ["a changed policy predicate", input => { input.policies[0].qual = "true"; }],
  ["a new storage write policy", input => input.policies.push({ ...input.policies.find(row => row.schemaname === "storage"), policyname: "synthetic_upload", cmd: "INSERT", qual: null, with_check: "true" })],
  ["a changed view definition", input => { input.views[0].definition = "SELECT true"; }],
  ["a duplicate relation", input => input.relations.push(input.relations[0])],
  ["a duplicate policy", input => input.policies.push(input.policies[0])],
  ["missing policy metadata", input => { delete input.policies; }],
  ["missing required relation fields", input => { delete input.relations[0].grants; }],
  ["changed identity helper code", input => { input.functions[0].definition_fingerprint = "changed"; }],
  ["an overload cannot stand in for the reviewed helper", input => { input.functions[0].arguments = "uuid"; }],
  ["a duplicate identity helper", input => input.functions.push(input.functions[0])],
  ["a private bucket becoming public", input => { input.buckets.find(bucket => !bucket.public).public = true; }],
  ["a new unreviewed bucket", input => input.buckets.push({ ...input.buckets[0], id: "synthetic_new_bucket" })],
  ["missing transaction read-only evidence", input => { delete input.read_only; }],
  ["invalid capture time", input => { input.captured_at = "invalid"; }],
];
for (const [name, change] of changes) test("access review rejects " + name, () => {
  const input = catalog(); change(input);
  assert.equal(reviewSupabaseAccessCatalog(input, expected).ok, false);
});

test("malformed input fails with fixed check names and no raw provider content", () => {
  assert.equal(reviewSupabaseAccessCatalog(null, expected).ok, false);
  const input = catalog(); input.policies[0].qual = "private-synthetic-diagnostic";
  const result = reviewSupabaseAccessCatalog(input, expected);
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /private-synthetic-diagnostic/);
});

test("CLI reads raw and wrapped exports, fails invalid input, and never echoes parser diagnostics", () => {
  const folder = mkdtempSync(join(tmpdir(), "access-review-"));
  const file = join(folder, "catalog.json");
  const script = new URL("../scripts/check-supabase-access.mjs", import.meta.url);
  const run = () => spawnSync(process.execPath, [fileURLToPath(script), file], { encoding: "utf8" });
  try {
    for (const data of [catalog(), { catalog: catalog() }, { rows: [{ catalog: catalog() }] }]) {
      writeFileSync(file, JSON.stringify(data));
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).ok, true);
    }
    writeFileSync(file, '{"private-synthetic-diagnostic"');
    const result = run();
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).ok, false);
    assert.doesNotMatch(result.stderr, /private-synthetic-diagnostic/);
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith("access-review-"));
    rmSync(folder, { recursive: true, force: true });
  }
});
