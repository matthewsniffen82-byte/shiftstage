import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createShiftColumnFixture, queryAsShiftRole, shiftColumnFixture, shiftPrivacySource } from "./helpers/shift-column-privacy-fixture.mjs";
import { publicShiftColumns, retiredShiftColumns } from "./helpers/shift-column-privacy-deployment.mjs";

const privateColumns = shiftColumnFixture.columns.map(row => row.column_name).filter(name => !publicShiftColumns.includes(name));
const fingerprint = "select md5(string_agg(md5(to_jsonb(s)::text),'' order by id))value from public.shifts s";
let db, priorFingerprint;
before(async () => {
  db = await createShiftColumnFixture();
  priorFingerprint = (await db.query(fingerprint)).rows[0].value;
  // Reproduce the exact captured grant exposure using synthetic records.
  for (const role of ["anon", "authenticated"]) {
    const beforeRows = await queryAsShiftRole(db, role, `select ${retiredShiftColumns.join(",")} from public.shifts`);
    assert.equal(beforeRows.rows.length, 1);assert.equal(Number(beforeRows.rows[0].checkin_distance_feet), 50.25);
    assert.equal(beforeRows.rows[0].nfc_tag_id, "40000000-0000-4000-8000-000000000001");
  }
  await db.exec(shiftPrivacySource);
});
after(async () => db?.close());
for (const role of ["anon", "authenticated"]) {
  test(`${role} retains all thirteen public schedule columns and row filtering`, async () => {
    const rows = await queryAsShiftRole(db, role, `select ${publicShiftColumns.join(",")} from public.shifts`);
    assert.equal(rows.rows.length, 1);assert.equal(rows.rows[0].status, "posted");assert.equal(rows.rows[0].venue_id, "30000000-0000-4000-8000-000000000001");
  });
  for (const column of privateColumns) test(`${role} cannot select or filter private shift ${column}`, async () => {
    for (const sql of [`select ${column} from public.shifts`, `select id from public.shifts where ${column} is not null`]) await assert.rejects(queryAsShiftRole(db, role, sql), error => error.code === "42501");
  });
  test(`${role} cannot retrieve composite records or gain shift write privileges`, async () => {
    for (const sql of ["select * from public.shifts", "select row_to_json(shifts)from public.shifts", "update public.shifts set status='cancelled'", "delete from public.shifts"]) await assert.rejects(queryAsShiftRole(db, role, sql), error => error.code === "42501");
  });
}
test("private service reads, unrelated grants and all records remain intact", async () => {
  const rows = await queryAsShiftRole(db, "service_role", "select status,checkin_latitude,checkin_distance_feet,nfc_tag_id from public.shifts order by id");
  assert.equal(rows.rows.length, 2);assert.equal(Number(rows.rows[0].checkin_latitude), 36.125);assert.equal(Number(rows.rows[0].checkin_distance_feet), 50.25);
  assert.equal((await queryAsShiftRole(db, "unrelated_reader", "select checkin_distance_feet from public.shifts")).rows.length, 1);
  assert.equal((await db.query(fingerprint)).rows[0].value, priorFingerprint);
  assert.equal((await db.query("select count(*)::integer n from pg_policies where tablename='shifts'")).rows[0].n, 1);
});
test("the column-only migration is safely repeatable", async () => { await db.exec(shiftPrivacySource); });
test("unexpected schema stops before access changes", async () => {
  await db.exec("alter table public.shifts add column future_private text");
  await assert.rejects(db.exec(shiftPrivacySource), /PUBLIC_SHIFT_COLUMN_SCHEMA_DRIFT/);
  await db.exec("rollback;alter table public.shifts drop column future_private");
});
