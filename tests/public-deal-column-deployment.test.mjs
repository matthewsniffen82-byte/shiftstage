import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildDealColumnDeployment, dealColumnTargetSql, dealColumnVersion } from "./helpers/public-deal-column-deployment.mjs";

const source=readFileSync(new URL("../supabase/migrations/20260912103000_minimize_public_deal_columns.sql",import.meta.url),"utf8");
const schema=JSON.parse(readFileSync(new URL("../docs/supabase-reliability/step-01-inventory.json",import.meta.url),"utf8")).catalog;
const names=["id","venue_id","deal_title","deal_description","deal_terms","is_active","valid_days","valid_start_time","valid_end_time","redemption_rules","payout_type","payout_amount_cents","created_at","updated_at","currency","offer_type","booking_url","sort_order","removed_at"];
let db;
before(async()=>{
  db=new PGlite();
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create role unrelated_reader;create schema auth;create schema storage;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);");
  const columns=names.map(name=>{
    const column=schema.columns.find(c=>c.table_name==="club_deals"&&c.column_name===name);
    const type=column ? column.udt_name==="_text"?"text[]":column.udt_name : "timestamptz";
    return `${name} ${type}`;
  });
  await db.exec(`create table club_deals(${columns.join(",")});alter table club_deals enable row level security;
    create policy public_offer on club_deals for select using(is_active);
    grant usage on schema public to anon,authenticated,service_role,unrelated_reader;
    grant select on club_deals to public,anon,authenticated,unrelated_reader;grant select(redemption_rules) on club_deals to authenticated;
    grant all on club_deals to service_role;
    insert into club_deals(id,deal_title,is_active,payout_amount_cents) values('10000000-0000-4000-8000-000000000001','Preserved offer',true,1234);
    create table untouched(id integer);grant select on untouched to anon;`);
});
after(async()=>db?.close());
async function target(){return (await db.query(dealColumnTargetSql)).rows[0].jsonb_build_object;}
async function dryRun(after="",expectedTarget){
  const sql=buildDealColumnDeployment({source,expectedTarget:expectedTarget||await target(),after});
  return db.exec(sql.replace(/commit;\s*$/,"rollback;"));
}
test("the complete guarded deployment succeeds without changing rows or unrelated metadata",async()=>{await dryRun();assert.equal((await db.query("select payout_amount_cents from club_deals")).rows[0].payout_amount_cents,1234);});
for(const [name,after,expected] of [
  ["deal row mutation","update club_deals set deal_title='changed';",/DEAL_COLUMNS_RECORDS_CHANGED/],
  ["another table grant","revoke select on untouched from anon;",/DEAL_COLUMNS_METADATA_CHANGED/],
  ["service grant removal","revoke update on club_deals from service_role;",/DEAL_COLUMNS_METADATA_CHANGED/],
  ["another reader grant removal","revoke select on club_deals from unrelated_reader;",/DEAL_COLUMNS_METADATA_CHANGED/],
  ["browser write grant","grant update on club_deals to authenticated;",/DEAL_COLUMNS_METADATA_CHANGED/],
  ["private column regrant","grant select(redemption_rules) on club_deals to anon;",/DEAL_COLUMNS_PROJECTION_MISMATCH/],
])test(`guarded deployment rolls back ${name}`,async()=>{await assert.rejects(dryRun(after),expected);await db.exec("rollback");assert.equal((await db.query("select count(*)::integer n from supabase_migrations.schema_migrations")).rows[0].n,0);});
test("catalog drift rejects the transaction before changes",async()=>{const expected=await target();expected.relation.owner="unexpected";await assert.rejects(dryRun("",expected),/DEAL_COLUMNS_ACCESS_DRIFT/);await db.exec("rollback");});
test("an inherited private-column grant fails closed and rolls back",async()=>{await db.exec("grant unrelated_reader to anon");await assert.rejects(dryRun(),/PUBLIC_DEAL_TABLE_SELECT_REMAINS/);await db.exec("rollback;revoke unrelated_reader from anon");});
test("actual commit records the exact source once and rejects replay",async()=>{
  await db.exec(buildDealColumnDeployment({source,expectedTarget:await target()}));
  const row=(await db.query("select * from supabase_migrations.schema_migrations")).rows[0];assert.equal(row.version,dealColumnVersion);assert.equal(row.statements[0],source.replaceAll("\r\n","\n"));
  await assert.rejects(dryRun(),/DEAL_COLUMNS_ALREADY_APPLIED/);await db.exec("rollback");
});
