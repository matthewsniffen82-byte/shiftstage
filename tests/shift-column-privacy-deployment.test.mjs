import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { createShiftColumnFixture, shiftPrivacySource } from "./helpers/shift-column-privacy-fixture.mjs";
import { buildShiftPrivacyDeployment, shiftPrivacyTargetSql, shiftPrivacyVersion } from "./helpers/shift-column-privacy-deployment.mjs";

let db;
before(async () => { db = await createShiftColumnFixture(); });
after(async () => db?.close());
async function target() { return (await db.query(shiftPrivacyTargetSql + " as target")).rows[0].target; }
const countLedger = async () => Number((await db.query("select count(*)n from supabase_migrations.schema_migrations")).rows[0].n);
test("the exact guarded deployment succeeds in a rolled-back native transaction", async () => {
  const expectedTarget = await target();
  const sql = buildShiftPrivacyDeployment({ source: shiftPrivacySource, expectedTarget });
  const result = await db.exec(sql.replace(/commit;\s*$/, "rollback;"));
  const receipt = result.flatMap(item => item.rows || []).find(row => row.release)?.release;
  assert.equal(receipt.version, shiftPrivacyVersion);assert.equal(receipt.records_preserved, true);assert.equal(receipt.metadata_preserved, true);assert.equal(receipt.public_columns, 13);assert.equal(receipt.private_columns, 25);
  assert.equal(await countLedger(), 0);assert.deepEqual(await target(), expectedTarget);
});
for (const [name, afterSql, message] of [
  ["business row mutation", "update public.shifts set timezone='UTC'", "SHIFT_PRIVACY_RECORDS_CHANGED"],
  ["unrelated table grant", "grant select on public.privacy_control to anon", "SHIFT_PRIVACY_METADATA_CHANGED"],
  ["lost service access", "revoke select on public.shifts from service_role", "SHIFT_PRIVACY_METADATA_CHANGED"],
  ["unrelated reader grant", "revoke select on public.shifts from unrelated_reader", "SHIFT_PRIVACY_METADATA_CHANGED"],
  ["lost public schedule field", "revoke select(id)on public.shifts from authenticated", "SHIFT_PRIVACY_METADATA_CHANGED"],
  ["new coordinate exposure", "grant select(checkin_latitude)on public.shifts to anon", "SHIFT_PRIVACY_METADATA_CHANGED"],
  ["retired field regrant", "grant select(checkin_distance_feet)on public.shifts to anon", "SHIFT_PRIVACY_PROJECTION_MISMATCH"],
  ["changed visibility policy", "alter policy published_schedule on public.shifts using(true)", "SHIFT_PRIVACY_METADATA_CHANGED"],
]) test(`deployment rolls back ${name} and records no migration`, async () => {
  const expectedTarget = await target();
  const sql = buildShiftPrivacyDeployment({ source: shiftPrivacySource, expectedTarget, after: afterSql + ";" });
  await assert.rejects(db.exec(sql), new RegExp(message));await db.exec("rollback");
  assert.equal(await countLedger(), 0);assert.deepEqual(await target(), expectedTarget);
  assert.equal((await db.query("select count(*)::integer n from public.shifts where timezone='UTC'")).rows[0].n, 0);
});
test("stale target permissions stop before migration execution", async () => {
  const expectedTarget = await target();
  await db.exec("grant select(created_at)on public.shifts to public");
  await assert.rejects(db.exec(buildShiftPrivacyDeployment({ source: shiftPrivacySource, expectedTarget })), /SHIFT_PRIVACY_ACCESS_DRIFT/);
  await db.exec("rollback;revoke select(created_at)on public.shifts from public");assert.equal(await countLedger(), 0);
});
test("inherited access stops the guarded migration and is preserved by rollback", async () => {
  await db.exec("create role inherited_shift_reader;grant select(checkin_distance_feet)on public.shifts to inherited_shift_reader;grant inherited_shift_reader to anon");
  const expectedTarget = await target();
  await assert.rejects(db.exec(buildShiftPrivacyDeployment({ source: shiftPrivacySource, expectedTarget })), /PUBLIC_SHIFT_COLUMN_ACCESS_MISMATCH/);
  await db.exec("rollback;revoke inherited_shift_reader from anon;revoke select(checkin_distance_feet)on public.shifts from inherited_shift_reader");assert.equal(await countLedger(), 0);
});
test("a committed deployment records only its exact source and rejects replay", async () => {
  await db.exec(buildShiftPrivacyDeployment({ source: shiftPrivacySource, expectedTarget: await target() }));
  const rows = (await db.query("select version,name,md5(array_to_string(statements,E'\\n'))source_md5 from supabase_migrations.schema_migrations")).rows;
  assert.equal(rows.length, 1);assert.equal(rows[0].version, shiftPrivacyVersion);assert.equal(rows[0].name, "minimize_public_shift_location_columns");
  assert.equal(rows[0].source_md5, createHash("md5").update(shiftPrivacySource.replaceAll("\r\n", "\n")).digest("hex"));
  await assert.rejects(db.exec(buildShiftPrivacyDeployment({ source: shiftPrivacySource, expectedTarget: await target() })), /SHIFT_PRIVACY_ALREADY_APPLIED/);await db.exec("rollback");
  assert.equal(await countLedger(), 1);
});
