import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const lifecycleSchema = JSON.parse(readFileSync(new URL("../fixtures/redemption-lifecycle-schema.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
export const lifecycleMigrationPath = "supabase/migrations/20260910041000_add_atomic_redemption_lifecycle_events.sql";
export const lifecycleMigration = readFileSync(new URL("../../" + lifecycleMigrationPath, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const lifecycleSignature = "public.record_deal_lifecycle_event_safely(text,text,uuid,text,text,text,text)";
export const fixtureId = n => "90000000-0000-4000-8000-" + String(n).padStart(12, "0");
const quote = identifier => '"' + identifier.replaceAll('"', '""') + '"';

export async function createLifecycleDatabase({ migrate = true } = {}) {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.venues(id uuid primary key);
      create table public.club_deals(id uuid primary key);
      create table public.dancer_profiles(id uuid primary key);
      create table public.nfc_tags(id uuid primary key);
      create table public.shifts(id uuid primary key);
      create table public.deal_revenue_events(id uuid primary key, audit jsonb);
      create table public.commission_events(id uuid primary key, audit jsonb);
    `);
    for (const table of lifecycleSchema.tables) {
      const columns = lifecycleSchema.columns.filter(column => column.table === table).map(column =>
        quote(column.name) + " " + quote(column.schema) + "." + quote(column.type)
        + (column.nullable === "NO" ? " not null" : "") + (column.default ? " default " + column.default : ""));
      await pg.exec("create table public." + quote(table) + "(" + columns.join(",") + ")");
    }
    // Parent unique constraints precede foreign keys in the child table.
    for (const table of lifecycleSchema.tables) {
      for (const constraint of lifecycleSchema.constraints.filter(row => row.table === table)) {
        await pg.exec("alter table public." + quote(table) + " add constraint " + quote(constraint.name) + " " + constraint.definition);
      }
    }
    for (const trigger of lifecycleSchema.triggers) {
      await pg.exec(trigger.function_definition + ";\n" + trigger.definition + ";");
    }
    await pg.exec(`
      alter table public.qr_redemptions enable row level security;
      alter table public.qr_redemption_events enable row level security;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant all on all tables in schema public,auth to service_role;
    `);
    if (migrate) await pg.exec(lifecycleMigration);
    return pg;
  } catch (error) { await pg.close(); throw error; }
}

export async function seedLifecycleDatabase(pg) {
  await pg.exec("reset role;drop trigger if exists synthetic_event_failure on public.qr_redemption_events;drop trigger if exists synthetic_timestamp_failure on public.qr_redemptions;truncate public.qr_redemption_events,public.qr_redemptions,public.deal_revenue_events,public.commission_events");
  for (const table of ["auth.users", "public.venues", "public.club_deals", "public.dancer_profiles", "public.nfc_tags", "public.shifts"]) {
    await pg.query("insert into " + table + "(id) values($1) on conflict do nothing", [fixtureId(1)]);
  }
  for (const n of [10, 11]) {
    await pg.query(`insert into public.qr_redemptions(id,redemption_token,venue_id,club_deal_id,source_type,expires_at,session_id,audit)
      values($1,$2,$3,$3,'club_page','2026-12-31Z',$4,'{"synthetic":"preserve"}')`, [fixtureId(n), "synthetic-token-" + String(n).repeat(20), fixtureId(1), fixtureId(2)]);
  }
  for (const table of ["deal_revenue_events", "commission_events"]) {
    await pg.query("insert into public." + table + " values($1,'{\"preserve\":true}')", [fixtureId(90)]);
  }
  await pg.exec("set role service_role");
}

export async function lifecycleSnapshot(pg) {
  const result = {};
  for (const table of ["qr_redemptions", "qr_redemption_events", "deal_revenue_events", "commission_events"]) {
    result[table] = (await pg.query("select * from public." + table + " order by id")).rows;
  }
  return result;
}
