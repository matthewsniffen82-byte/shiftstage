import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260909124500_protect_admin_audit_history.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/migrations/202606250001_initial_schema.sql", import.meta.url), "utf8");
const admin = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const event = "20000000-0000-4000-8000-000000000001";

async function database(hardened = true) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table app_users(id uuid primary key,role text,account_state text);
    ${schema.match(/create table public\.admin_actions \([\s\S]*?\n\);/)[0]}
    ${schema.match(/create or replace function public\.is_admin\(\)[\s\S]*?\$\$;/)[0]}
    alter table public.admin_actions enable row level security;
    create policy "admins manage admin actions" on public.admin_actions for all using(public.is_admin()) with check(public.is_admin());
    grant select,truncate,references,trigger on admin_actions to anon;
    grant all on admin_actions to authenticated,service_role;
    grant update(notes),insert(action) on admin_actions to authenticated;
    insert into app_users values('${admin}','admin','active'),('${other}','customer','active');
    insert into admin_actions(id,admin_id,target_type,target_id,action,notes) values('${event}','${admin}','dancer_profile','${other}','disable_dancer_profile','Synthetic audit note');`);
  if (hardened) await db.exec(migration);
  return db;
}
async function asRole(db, role, id, operation) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id || ""]);
    await db.exec(`set local role ${role}`);
    return await operation();
  } finally { await db.exec("rollback"); }
}

test("the audited baseline reproduces admin event forgery, alteration and deletion on synthetic rows", async () => {
  const db = await database(false);
  try {
    await asRole(db, "authenticated", admin, async () => {
      assert.equal((await db.query("update admin_actions set notes='forged' returning id")).rows.length, 1);
      assert.equal((await db.query("delete from admin_actions returning id")).rows.length, 1);
      assert.equal((await db.query("insert into admin_actions(admin_id,target_type,action) values($1,'account','forged') returning id", [other])).rows.length, 1);
    });
  } finally { await db.close(); }
});

test("browser audit access is read-only even for an active administrator", async () => {
  const db = await database();
  try {
    for (const [role, id] of [["anon", null], ["authenticated", other], ["authenticated", admin]]) {
      for (const sql of [
        "insert into admin_actions(target_type,action) values('account','forged') returning id",
        "update admin_actions set notes='forged' returning id",
        "delete from admin_actions returning id",
        "truncate admin_actions",
      ]) await assert.rejects(asRole(db, role, id, () => db.query(sql)), error => error.code === "42501");
    }
    const { rows } = await asRole(db, "authenticated", admin, () => db.query("select * from admin_actions"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, "Synthetic audit note");
    assert.equal(rows[0].admin_id, admin);
    assert.equal((await asRole(db, "authenticated", other, () => db.query("select * from admin_actions"))).rows.length, 0);
    await assert.rejects(asRole(db, "anon", null, () => db.query("select * from admin_actions")), error => error.code === "42501");
  } finally { await db.close(); }
});

test("inactive admins and forged role metadata cannot read audit history", async () => {
  const db = await database();
  try {
    for (const state of ["disabled", "deleted"]) {
      await db.query("update app_users set account_state=$1 where id=$2", [state, admin]);
      await asRole(db, "authenticated", admin, async () => {
        await db.exec(`select set_config('request.jwt.claims','{"role":"authenticated","user_metadata":{"role":"admin","account_state":"active"}}',true)`);
        assert.equal((await db.query("select * from admin_actions")).rows.length, 0);
      });
    }
  } finally { await db.close(); }
});

test("server event inserts, historical records and account-deletion anonymization remain intact", async () => {
  const db = await database();
  try {
    await asRole(db, "service_role", null, async () => {
      const result = await db.query("insert into admin_actions(admin_id,target_type,target_id,action) values($1,'account',$2,'synthetic_server_action') returning id,created_at", [admin, other]);
      assert.equal(result.rows.length, 1);
      assert.ok(result.rows[0].id && result.rows[0].created_at);
    });
    await db.query("delete from app_users where id=$1", [admin]);
    const { rows } = await db.query("select id,admin_id,action,notes from admin_actions");
    assert.deepEqual(rows, [{ id: event, admin_id: null, action: "disable_dancer_profile", notes: "Synthetic audit note" }]);
    await db.exec(migration);
    assert.equal((await db.query("select count(*)::int as count from admin_actions")).rows[0].count, 1);
  } finally { await db.close(); }
});
