import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const counterSchema = JSON.parse(readFileSync(new URL("../fixtures/counter-submission-schema.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
export const counterMigrationPath = "supabase/migrations/20260910050900_add_atomic_counter_notice_submission.sql";
export const counterMigration = readFileSync(new URL("../../" + counterMigrationPath, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const counterSignature = "public.submit_dmca_counter_notice_safely(uuid,uuid,jsonb)";
export const fixtureId = n => "92000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const counterTables = ["dmca_cases", "dmca_counter_notices", "dmca_strikes"];
export const counterInput = {
  legalName: "Synthetic Uploader", email: "synthetic@example.invalid", phone: "5555555555",
  address: "123 Synthetic Street", removedMaterialLocation: "https://example.invalid/removed",
  signature: "Synthetic Uploader", mistakeBeliefConfirmed: true, perjuryConfirmed: true,
  jurisdictionConfirmed: true, serviceConfirmed: true,
};
const quote = value => '"' + value.replaceAll('"', '""') + '"';
export async function createCounterDatabase({ migrate = true } = {}) {
  const pg = new PGlite();
  try {
    // Related account/media tables are synthetic projections for preservation
    // checks. All 59 case/counter/strike columns and 26 constraints are captured.
    await pg.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
      create table public.app_users(id uuid primary key,account_state text,dmca_suspended_at timestamptz);
      create table public.mydancr_tv_videos(id uuid primary key,status text);
    `);
    for (const table of counterTables) {
      const columns = counterSchema.columns.filter(row => row.table === table).map(row => quote(row.name) + " " + quote(row.schema) + "." + quote(row.type)
        + (row.nullable === "NO" ? " not null" : "") + (row.default ? " default " + row.default : ""));
      await pg.exec("create table public." + quote(table) + "(" + columns.join(",") + ")");
      for (const row of counterSchema.constraints.filter(row => row.table === table)) {
        await pg.exec("alter table public." + quote(table) + " add constraint " + quote(row.name) + " " + row.definition);
      }
      await pg.exec("alter table public." + quote(table) + " enable row level security");
    }
    await pg.exec("grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role");
    if (migrate) await pg.exec(counterMigration);
    return pg;
  } catch (error) { await pg.close(); throw error; }
}
export async function seedCounterDatabase(pg) {
  await pg.exec("reset role;set timezone='UTC'");
  for (const table of counterTables) await pg.exec("drop trigger if exists synthetic_failure on public." + table);
  await pg.exec("truncate public.dmca_counter_notices,public.dmca_strikes,public.dmca_cases,public.app_users,public.mydancr_tv_videos");
  for (const n of [1, 2]) await pg.query("insert into public.app_users values($1,'active',null)", [fixtureId(n)]);
  await pg.query("insert into public.mydancr_tv_videos values($1,'hidden')", [fixtureId(30)]);
  for (const [n, uploader] of [[10, 1], [11, 2]]) {
    await pg.query(`insert into public.dmca_cases(id,claimant_name,claimant_email,claimant_phone,claimant_address,
      copyrighted_work_description,infringing_url,target_type,target_id,uploader_id,status,
      good_faith_confirmed,accuracy_confirmed,authority_confirmed,signature,request_ip_hash,disabled_at,admin_notes)
      values($1,'Synthetic Claimant','claimant@example.invalid','5555555555','123 Synthetic Street',
      'Synthetic description','https://example.invalid/video','tv_video',$2,$3,'disabled',true,true,true,
      'Synthetic Claimant','synthetic-hash','2026-01-01Z','Keep administration notes')`, [fixtureId(n), fixtureId(30), fixtureId(uploader)]);
    await pg.query("insert into public.dmca_strikes(id,case_id,user_id) values($1,$2,$3)", [fixtureId(n + 10), fixtureId(n), fixtureId(uploader)]);
  }
  await pg.exec("set role service_role");
}
export async function counterSnapshot(pg) {
  const result = {};
  for (const table of [...counterTables, "app_users", "mydancr_tv_videos"]) result[table] = (await pg.query("select * from public." + table + " order by id")).rows;
  return result;
}
export async function submitCounter(pg, { user = fixtureId(1), caseId = fixtureId(10), details = counterInput } = {}) {
  return (await pg.query("select public.submit_dmca_counter_notice_safely($1,$2,$3::jsonb) as result", [user, caseId, JSON.stringify(details)])).rows[0].result;
}
