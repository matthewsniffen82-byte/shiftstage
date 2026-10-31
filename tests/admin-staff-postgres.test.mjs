import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const read = path => readFileSync(path, 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table app_users(id uuid primary key,role text,account_state text default 'active',admin_workspace_role text default 'owner',display_name text,email text,dmca_suspended_at timestamptz);
    create table customer_profiles(user_id uuid primary key);
    create table admin_actions(admin_id uuid,action text,target_type text,target_id uuid,notes text);
    grant all on all tables in schema public to service_role;`);
  const workspace = read('supabase/migrations/20261023042742_admin_operations_workspace.sql');
  await db.exec(workspace.slice(workspace.indexOf('create or replace function public.assert_admin_workspace_access'), workspace.indexOf('create table public.admin_review_claims')));
  await db.exec(read('supabase/migrations/20261031024041_admin_staff_creation.sql'));
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('reset role; truncate app_users,customer_profiles,admin_actions;');
  await db.query("insert into app_users(id,role) values($1,'admin')", [id(1)]);
  await db.query("insert into app_users(id,role,email) values($1,'customer','staff@example.invalid');", [id(2)]);
  await db.query('insert into customer_profiles values($1)', [id(2)]);
  await db.exec('set role service_role');
});
const add = (role = 'reviewer', actor = id(1), email = 'staff@example.invalid') => db.query('select provision_admin_staff($1,$2,$3,$4,$5) staff', [actor, id(2), email, 'Sam', role]);
test('each supported scope is assigned atomically with one audit entry and retry preserves later role edits', async () => {
  for (const role of ['reviewer','support','billing','compliance','owner']) {
    await db.query("update app_users set role='customer' where id=$1", [id(2)]);
    const result = await add(role); assert.equal(result.rows[0].staff.admin_workspace_role, role);
  }
  await db.query("update app_users set admin_workspace_role='billing' where id=$1", [id(2)]);
  assert.equal((await add()).rows[0].staff.admin_workspace_role, 'billing');
  assert.equal((await db.query('select * from admin_actions')).rows.length, 5);
  assert.equal((await db.query('select * from customer_profiles')).rows.length, 0);
});
test('browser roles, restricted staff, suspended owners and self-assignment are denied', async () => {
  for (const role of ['anon','authenticated']) { await db.exec(`reset role; set role ${role}`); await assert.rejects(add(), /permission denied/); }
  await db.exec('reset role; set role service_role');
  for (const scope of ['reviewer','support','billing','compliance']) {
    await db.query('update app_users set admin_workspace_role=$1 where id=$2', [scope,id(1)]); await assert.rejects(add(), /permission required/);
  }
  await db.query("update app_users set admin_workspace_role='owner',account_state='paused' where id=$1", [id(1)]); await assert.rejects(add(), /permission required/);
  await db.query("update app_users set account_state='active',dmca_suspended_at=now() where id=$1", [id(1)]); await assert.rejects(add(), /permission required/);
  assert.equal((await db.query('select * from admin_actions')).rows.length, 0);
});
test('non-customer roles, mismatched identities and invalid scopes are rejected', async () => {
  for (const role of ['venue','dancer']) { await db.query('update app_users set role=$1 where id=$2',[role,id(2)]); await assert.rejects(add(), /existing login/); }
  await assert.rejects(add('reviewer',id(1),'wrong@example.invalid'), /Active account required/);
  await assert.rejects(add('root'), /Invalid staff/); await assert.rejects(add(null), /Invalid staff/);
});
test('an audit failure rolls back the role grant and customer cleanup', async () => {
  await db.exec("reset role; create function fail_staff_audit() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable'; end$$; create trigger fail_staff_audit before insert on admin_actions for each row execute function fail_staff_audit(); set role service_role;");
  try {
    await assert.rejects(add(), /Audit unavailable/);
    assert.equal((await db.query('select role from app_users where id=$1',[id(2)])).rows[0].role,'customer');
    assert.equal((await db.query('select * from customer_profiles')).rows.length,1);
  } finally { await db.exec('reset role; drop trigger fail_staff_audit on admin_actions; drop function fail_staff_audit();'); }
});
