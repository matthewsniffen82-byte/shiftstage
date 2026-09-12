import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260912103000_minimize_public_deal_columns.sql", import.meta.url), "utf8");
const publicColumns = ["id","venue_id","deal_title","deal_description","deal_terms","is_active","valid_days","valid_start_time","valid_end_time","offer_type","booking_url","sort_order"];
const privateColumns = ["redemption_rules","payout_type","payout_amount_cents","created_at","updated_at","currency","removed_at"];
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role unrelated_reader;
    grant usage on schema public to anon, authenticated, service_role, unrelated_reader;
    create table club_deals (
      id uuid primary key,venue_id uuid,deal_title text,deal_description text,deal_terms text,is_active boolean,
      valid_days text[],valid_start_time time,valid_end_time time,redemption_rules jsonb,payout_type text,
      payout_amount_cents integer,created_at timestamptz,updated_at timestamptz,currency text,offer_type text,
      booking_url text,sort_order integer,removed_at timestamptz);
    alter table club_deals enable row level security;
    create policy public_offer on club_deals for select using(is_active);
    grant select on club_deals to public,anon,authenticated,unrelated_reader;
    grant select(payout_amount_cents,redemption_rules) on club_deals to public,anon,authenticated;
    grant all on club_deals to service_role;
    insert into club_deals(id,deal_title,is_active,payout_amount_cents,redemption_rules) values
      ('10000000-0000-4000-8000-000000000001','Public offer',true,1234,'{"internal":"synthetic"}'),
      ('10000000-0000-4000-8000-000000000002','Inactive offer',false,4321,'{}');`);
  await db.exec(migration);
});
after(async () => db?.close());
async function asRole(role,sql) {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql); } finally { await db.exec("reset role"); }
}
for (const role of ["anon","authenticated"]) {
  test(`${role} retains exactly the visible public offer projection`, async () => {
    const result = await asRole(role, `select ${publicColumns.join(",")} from club_deals`);
    assert.equal(result.rows.length,1); assert.equal(result.rows[0].deal_title,"Public offer");
  });
  for (const column of privateColumns) test(`${role} cannot select or filter on internal ${column}`, async () => {
    for (const sql of [`select ${column} from club_deals`,`select id from club_deals where ${column} is not null`]) {
      await assert.rejects(asRole(role,sql), error => error.code === "42501");
    }
  });
  test(`${role} cannot request a composite record or write data`, async () => {
    for (const sql of ["select * from club_deals","select row_to_json(club_deals) from club_deals","update club_deals set deal_title='changed'", "delete from club_deals"]) {
      await assert.rejects(asRole(role,sql),error => error.code === "42501");
    }
  });
}
test("service access, unrelated grants, rows and row policies survive",async()=>{
  const rows=await asRole("service_role","select deal_title,payout_amount_cents,redemption_rules from club_deals order by id");
  assert.equal(rows.rows.length,2); assert.equal(rows.rows[0].payout_amount_cents,1234);
  assert.deepEqual(rows.rows[0].redemption_rules,{internal:"synthetic"});
  assert.equal((await asRole("unrelated_reader","select payout_amount_cents from club_deals")).rows.length,1);
  assert.equal((await db.query("select count(*)::integer n from pg_policies where tablename='club_deals'")).rows[0].n,1);
});
test("the exact migration is safely repeatable",async()=>{ await db.exec(migration); });
test("unexpected schema fails before grants change",async()=>{
  await db.exec("alter table club_deals add column future_private text");
  await assert.rejects(db.exec(migration),/PUBLIC_DEAL_COLUMN_SCHEMA_DRIFT/);
  await db.exec("rollback; alter table club_deals drop column future_private");
  assert.equal((await db.query("select has_table_privilege('anon','club_deals','SELECT') allowed")).rows[0].allowed,false);
});
