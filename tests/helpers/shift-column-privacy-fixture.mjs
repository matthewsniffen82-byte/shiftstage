import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { shiftPrivacyVersion } from "./shift-column-privacy-deployment.mjs";

export const shiftColumnFixture = JSON.parse(readFileSync(new URL("../fixtures/shift-public-columns.json", import.meta.url), "utf8"));
export const shiftPrivacySource = readFileSync(new URL(`../../supabase/migrations/${shiftPrivacyVersion}_minimize_public_shift_location_columns.sql`, import.meta.url), "utf8");
const identifier = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/); return '"' + value + '"'; };
const types = new Set(["uuid", "timestamp with time zone", "text", "integer", "numeric", "date", "jsonb"]);
export async function createShiftColumnFixture() {
  const db = new PGlite();
  const columns = shiftColumnFixture.columns.map(column => {
    const type = column.data_type === "USER-DEFINED" ? "public.shift_status" : column.data_type;
    assert.ok(type === "public.shift_status" || types.has(type));
    return `${identifier(column.column_name)} ${type}${column.column_default ? " default " + column.column_default : ""}${column.is_nullable === "NO" ? " not null" : ""}`;
  }).join(",\n");
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role unrelated_reader;
    grant usage on schema public to anon,authenticated,service_role,unrelated_reader;
    create type public.shift_status as enum('draft','posted','cancelled','completed');
    create table public.shifts(${columns},primary key(id));
    alter table public.shifts enable row level security;
    create policy published_schedule on public.shifts for select using(status='posted');
    grant select(${shiftColumnFixture.granted.map(row => identifier(row.column)).join(",")})on public.shifts to anon,authenticated;
    grant all on public.shifts to service_role;grant select on public.shifts to unrelated_reader;
    create table public.privacy_control(id integer primary key,content text);
    grant all on public.privacy_control to service_role;
    create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
    insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,shift_date,status,checkin_latitude,checkin_longitude,checkin_distance_feet,nfc_tag_id,venue_affiliation_id)values
      ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2030-01-01','2030-01-02','2030-01-01','posted',36.125,-115.25,50.25,'40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','2030-01-01','2030-01-02','2030-01-01','cancelled',36.25,-115.5,75.5,null,null);`);
  return db;
}
export async function queryAsShiftRole(db, role, sql) {
  assert.ok(["anon", "authenticated", "service_role", "unrelated_reader"].includes(role));
  await db.exec(`set role ${role}`);
  try { return await db.query(sql); } finally { await db.exec("reset role"); }
}
