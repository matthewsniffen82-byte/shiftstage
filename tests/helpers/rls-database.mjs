import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// A policy-only PostgreSQL fixture, not a replay of the historical migrations.
// No production rows, credentials or side-effect triggers are loaded. Constraints
// are included for the five changed tables; other tables test policy semantics only.
export const catalog = JSON.parse(readFileSync(new URL("../../docs/supabase-reliability/step-01-inventory.json", import.meta.url), "utf8")).catalog;
export const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
export const tables = catalog.relations.filter(r => r.schema_name === "public" && r.kind === "r");
export const preferenceTables = ["customer_profiles", "favorites", "follows", "going_signals", "venue_follows"];
export const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  other: "10000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000003",
  disabled: "10000000-0000-4000-8000-000000000004",
};

export async function createPolicyDatabase({ applyCurrentMigration = true } = {}) {
  const db = new PGlite();
  const statements = [
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;",
    "grant usage on schema public, auth to anon, authenticated, service_role;",
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  ];
  for (const e of catalog.enums.filter(e => e.schema_name === "public")) {
    statements.push(`create type public.${quote(e.name)} as enum (${e.labels.map(literal).join(",")});`);
  }
  for (const table of tables) {
    const columns = catalog.columns.filter(c => c.table_schema === "public" && c.table_name === table.name);
    statements.push(`create table public.${quote(table.name)} (${columns.map(c => `${quote(c.column_name)} ${c.udt_name === "_text" ? "text[]" : `${quote(c.udt_schema)}.${quote(c.udt_name)}`} ${preferenceTables.includes(table.name) ? `${c.column_default ? `default ${c.column_default}` : ""} ${c.is_nullable === "NO" ? "not null" : ""}` : ""}`).join(",")});`);
    if (table.rls) statements.push(`alter table public.${quote(table.name)} enable row level security;`);
  }
  for (const table of ["app_users", "dancer_profiles", "shifts", "venues"]) {
    statements.push(`alter table public.${quote(table)} add primary key (id);`);
  }
  for (const c of catalog.constraints.filter(c => c.schema_name === "public" && preferenceTables.includes(c.table_name))) {
    statements.push(`alter table public.${quote(c.table_name)} add constraint ${quote(c.name)} ${c.definition};`);
  }
  const schema = readFileSync(new URL("../../supabase/migrations/202606250001_initial_schema.sql", import.meta.url), "utf8");
  for (const name of ["is_admin", "current_user_role"]) {
    const definition = schema.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, "i"));
    if (!definition) throw new Error(`Missing audited helper ${name}`);
    statements.push(definition[0]);
  }
  for (const p of catalog.policies.filter(p => p.schemaname === "public")) {
    statements.push(`create policy ${quote(p.policyname)} on public.${quote(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(",")} ${p.qual ? `using (${p.qual})` : ""} ${p.with_check ? `with check (${p.with_check})` : ""};`);
  }
  for (const table of tables) {
    for (const [role, grants] of Object.entries(table.grants)) {
      const commands = Object.entries(grants).filter(([, allowed]) => allowed).map(([command]) => command);
      if (commands.length) statements.push(`grant ${commands.join(",")} on public.${quote(table.name)} to ${quote(role)};`);
    }
  }
  // Exact column grants captured separately from pg_attribute on 2026-09-09.
  const columnGrants = JSON.parse(readFileSync(new URL("../fixtures/rls-column-grants.json", import.meta.url), "utf8"));
  for (const [table, columns] of Object.entries(columnGrants)) {
    statements.push(`grant select (${columns.map(quote).join(",")}) on public.${quote(table)} to anon, authenticated;`);
  }
  for (const view of catalog.views.filter(v => v.schemaname === "public")) {
    const r = catalog.relations.find(r => r.schema_name === "public" && r.name === view.viewname);
    statements.push(`create view public.${quote(view.viewname)} ${r.options?.length ? `with (${r.options.join(",")})` : ""} as ${view.definition};`);
    for (const [role, grants] of Object.entries(r.grants)) {
      if (grants.select) statements.push(`grant select on public.${quote(view.viewname)} to ${quote(role)};`);
    }
  }
  await db.exec(statements.join("\n"));
  // One synthetic private record in every base table makes negative tests non-vacuous.
  const referenced = ["app_users", "dancer_profiles", "shifts", "venues"];
  const seedOrder = [...tables.filter(t => referenced.includes(t.name)), ...tables.filter(t => !referenced.includes(t.name))];
  for (const table of seedOrder) {
    const columns = catalog.columns.filter(c => c.table_schema === "public" && c.table_name === table.name && (c.udt_name === "uuid" || c.udt_name === "bool"));
    await db.exec(`insert into public.${quote(table.name)} (${columns.map(c => quote(c.column_name)).join(",")}) values (${columns.map(c => c.udt_name === "uuid" ? literal(ids.owner) : "false").join(",")});`);
  }
  await db.exec(`update app_users set role='customer', account_state='active' where id=${literal(ids.owner)};
    insert into app_users(id,role,account_state) values (${literal(ids.other)},'customer','active'),(${literal(ids.admin)},'admin','active'),(${literal(ids.disabled)},'customer','disabled');`);
  await db.exec(`insert into dancer_profiles(id,user_id,status,is_public) values (${literal(ids.other)},${literal(ids.other)},'draft',false);
    insert into venues(id,owner_user_id,is_active) values (${literal(ids.other)},${literal(ids.other)},false);
    insert into venue_team_members(id,venue_id,user_id,status) values (${literal(ids.other)},${literal(ids.other)},${literal(ids.other)},'active');`);
  if (applyCurrentMigration) await db.exec(readFileSync(new URL("../../supabase/migrations/20260909110000_enforce_active_account_preference_writes.sql", import.meta.url), "utf8"));
  return db;
}

export async function asIdentity(db, role, userId, action) {
  await db.exec("begin;");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId || ""]);
    await db.exec(`set local role ${quote(role)};`);
    return await action();
  } finally {
    await db.exec("rollback;");
  }
}

export async function deniedOrEmpty(action) {
  try {
    const result = await action();
    return result.rows.length === 0 && (!result.affectedRows || result.affectedRows === 0);
  } catch (error) {
    if (error.code === "42501") return true;
    throw error;
  }
}
