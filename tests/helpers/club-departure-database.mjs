import { readFileSync } from "node:fs";
import { createAccountLifecycleDatabase } from "./account-lifecycle-database.mjs";
import { shiftSchema } from "./shift-temporal-database.mjs";

const read = name => readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
export const clubDepartureMigration = read("20260922020000_preserve_dancers_when_clubs_leave");
export const dancerRetapMigration = read("20260922030000_allow_dancer_reconnection_by_tap");
const quote = value => `"${value.replaceAll('"', '""')}"`;

export async function createClubDepartureDatabase({ migrate = true } = {}) {
  const db = await createAccountLifecycleDatabase();
  try {
    // Real account/venue/profile and shift schemas; auxiliary NFC/affiliation
    // tables use their checked-in DDL. No production records or external writes.
    const affiliation = read("202608050001_dancer_venue_affiliations");
    const nfc = read("202608090003_nfc_tap_experience");
    for (const [source, names] of [[affiliation, ["venue_dancer_affiliations", "venue_dancer_verification_tokens", "venue_dancer_affiliation_events"]], [nfc, ["nfc_tags", "dancer_nfc_enrollments"]]]) {
      for (const name of names) {
        const ddl = source.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
        if (!ddl) throw new Error(`Missing fixture DDL: ${name}`);
        await db.exec(ddl);
      }
    }
    for (const value of shiftSchema.enums) {
      if (!(await db.query("select 1 from pg_type where typname=$1", [value.name])).rows.length) {
        await db.exec(`create type public.${quote(value.name)} as enum(${value.labels.map(label => `'${label}'`).join(",")})`);
      }
    }
    await db.exec(`create table public.shifts(${shiftSchema.columns.map(column => `${quote(column.column_name)} ${quote(column.udt_schema)}.${quote(column.udt_name)}${column.column_default ? ` default ${column.column_default}` : ""}${column.is_nullable === "NO" ? " not null" : ""}`).join(",")})`);
    for (const constraint of shiftSchema.constraints) await db.exec(`alter table public.shifts add constraint ${quote(constraint.name)} ${constraint.definition}`);
    for (const fn of shiftSchema.functions) if (fn.name !== "is_admin") await db.exec(fn.definition);
    for (const trigger of shiftSchema.triggers) await db.exec(trigger.definition);
    await db.exec("grant all on public.shifts,public.nfc_tags,public.dancer_nfc_enrollments,public.venue_dancer_affiliations,public.venue_dancer_verification_tokens,public.venue_dancer_affiliation_events to service_role");
    if (migrate) { await db.exec(clubDepartureMigration); await db.exec(dancerRetapMigration); }
    return db;
  } catch (error) { await db.close(); throw error; }
}
