import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const nfcSchema = JSON.parse(readFileSync(new URL("../fixtures/nfc-support-schema.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
export const nfcMigrationPath = "supabase/migrations/20260910043551_add_atomic_venue_nfc_support.sql";
export const nfcMigration = readFileSync(new URL("../../" + nfcMigrationPath, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const nfcSignature = "public.create_venue_nfc_support_safely(uuid,uuid,uuid,text,text,uuid)";
export const supportSignature = "public.create_support_message_safely(uuid,text,uuid,text,text,uuid)";
export const fixtureId = n => "91000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const targetTables = ["support_threads", "support_messages", "notifications", "venue_nfc_support_requests"];
const quote = value => '"' + value.replaceAll('"', '""') + '"';

export async function createNfcDatabase({ migrate = true } = {}) {
  const pg = new PGlite();
  try {
    await pg.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;");
    for (const item of nfcSchema.enums) {
      await pg.exec("create type public." + quote(item.name) + " as enum (" + item.labels.map(label => "'" + label.replaceAll("'", "''") + "'").join(",") + ")");
    }
    // Control relations are synthetic projections; the four write targets below use
    // all captured columns, defaults, nullability and constraints without simplifying them.
    await pg.exec(`
      create table public.app_users(id uuid primary key,role public.user_role not null,account_state public.account_state not null,display_name text,email text);
      create table public.venues(id uuid primary key,name text not null,owner_user_id uuid references public.app_users(id),is_active boolean not null default false);
      create table public.venue_team_members(id uuid primary key,venue_id uuid references public.venues(id),user_id uuid references public.app_users(id),role text,status text);
      create table public.nfc_tags(id uuid primary key,venue_id uuid references public.venues(id),label text not null,tag_type text not null,status text);
    `);
    for (const table of targetTables) {
      const columns = nfcSchema.columns.filter(column => column.table === table).map(column =>
        quote(column.name) + " " + quote(column.schema) + "." + quote(column.type)
        + (column.nullable === "NO" ? " not null" : "") + (column.default ? " default " + column.default : ""));
      await pg.exec("create table public." + quote(table) + "(" + columns.join(",") + ")");
      for (const constraint of nfcSchema.constraints.filter(row => row.table === table)) {
        await pg.exec("alter table public." + quote(table) + " add constraint " + quote(constraint.name) + " " + constraint.definition);
      }
      await pg.exec("alter table public." + quote(table) + " enable row level security");
    }
    await pg.exec(nfcSchema.support_function.definition);
    await pg.exec(`revoke all on function ${supportSignature} from public,anon,authenticated;
      grant execute on function ${supportSignature} to service_role;
      grant usage on schema public to anon,authenticated,service_role;
      grant all on all tables in schema public to service_role;`);
    if (migrate) await pg.exec(nfcMigration);
    return pg;
  } catch (error) { await pg.close(); throw error; }
}

export async function seedNfcDatabase(pg) {
  await pg.exec("reset role");
  for (const table of targetTables) await pg.exec("drop trigger if exists synthetic_failure on public." + table);
  await pg.exec("truncate " + [...targetTables, "venue_team_members", "nfc_tags", "venues", "app_users"].map(table => "public." + table).join(","));
  for (const [n, role] of [[1, "venue"], [2, "venue"], [3, "venue"], [4, "venue"], [5, "admin"], [6, "dancer"], [7, "customer"]]) {
    await pg.query("insert into public.app_users values($1,$2,'active','Synthetic account','synthetic@example.invalid')", [fixtureId(n), role]);
  }
  for (const [venue, owner, tag] of [[10, 1, 20], [11, 4, 21]]) {
    await pg.query("insert into public.venues values($1,'Synthetic venue',$2,false)", [fixtureId(venue), fixtureId(owner)]);
    await pg.query("insert into public.nfc_tags values($1,$2,'Synthetic sticker','dressing_room','active')", [fixtureId(tag), fixtureId(venue)]);
  }
  for (const [n, user, role] of [[30, 2, "manager"], [31, 3, "staff"]]) {
    await pg.query("insert into public.venue_team_members values($1,$2,$3,$4,'active')", [fixtureId(n), fixtureId(10), fixtureId(user), role]);
  }
  await pg.exec("set role service_role");
}

export async function nfcSnapshot(pg) {
  const result = {};
  for (const table of [...targetTables, "app_users", "venues", "nfc_tags", "venue_team_members"]) {
    result[table] = (await pg.query("select * from public." + table + " order by id")).rows;
  }
  return result;
}

export async function requestNfcSupport(pg, overrides = {}) {
  const input = { user: fixtureId(1), venue: fixtureId(10), tag: fixtureId(20), type: "damaged", notes: "Synthetic details", id: fixtureId(100), ...overrides };
  return (await pg.query("select public.create_venue_nfc_support_safely($1,$2,$3,$4,$5,$6) as result", [input.user, input.venue, input.tag, input.type, input.notes, input.id])).rows[0].result;
}
