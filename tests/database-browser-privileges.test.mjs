import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { asIdentity, createPolicyDatabase, deniedOrEmpty, ids, quote } from "./helpers/rls-database.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/database-browser-grants.json", import.meta.url), "utf8"));
const migration = readFileSync(new URL("../supabase/migrations/20260909233000_restrict_browser_table_privileges.sql", import.meta.url), "utf8");
const functions = readFileSync(new URL("./fixtures/database-admin-functions.sql", import.meta.url), "utf8");
let db;
let beforeSnapshot;
const beforeCommands = [];
const snapshot = async () => ({
  policies: (await db.query("select * from pg_policies where schemaname='public' order by tablename, policyname")).rows,
  dml: (await db.query("select c.relname, r.role, p.privilege, has_table_privilege(r.role,c.oid,p.privilege) allowed from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values ('anon'),('authenticated'),('service_role')) r(role) cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege) where n.nspname='public' and c.relkind in ('r','v') order by 1,2,3")).rows,
  columns: (await db.query("select c.relname,a.attname,a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attacl is not null order by 1,2")).rows,
  functions: (await db.query("select p.oid::regprocedure::text name, p.proacl::text, p.proconfig, p.prosecdef, pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1")).rows,
});

before(async () => {
  db = await createPolicyDatabase();
  await db.exec(functions);
  await db.exec("revoke create on schema public from public, anon, authenticated;");
  // Test-only workspace to exercise REFERENCES; production public-schema CREATE stays denied.
  await db.exec("create schema synthetic; grant usage, create on schema synthetic to anon, authenticated;");
  await db.exec(`grant ${fixture.privileges.join(",")} on table ${fixture.tables.map(t => "public." + quote(t)).join(",")} to anon, authenticated, service_role;`);
  // A separate inheritance case: revoking role-specific grants alone is insufficient.
  await db.exec("grant truncate, references, trigger, maintain on public.support_threads to public;");
  for (const role of fixture.roles) {
    const hidden = await asIdentity(db, role, ids.other, () => db.query("select 1 from public.support_threads"));
    assert.equal(hidden.rows.length, 0);
    for (const command of [
      "truncate public.support_threads",
      "create trigger synthetic_only before update on public.support_threads for each row execute function pg_catalog.suppress_redundant_updates_trigger()",
      "create table synthetic.reference (account_id uuid references public.app_users(id))",
    ]) {
      // Synthetic data only. Each attempted operation is rolled back immediately.
      await asIdentity(db, role, ids.other, () => db.exec(command));
      beforeCommands.push([role, command]);
    }
  }
  beforeSnapshot = await snapshot();
  if (process.env.MYDANCR_TEST_SKIP_PRIVILEGE_MIGRATION !== "1") await db.exec(migration);
});
after(async () => { await db?.close(); });

test("database baseline reproduces bulk/schema privileges despite row-level denials", () => {
  assert.equal(beforeCommands.length, 6);
});

for (const table of fixture.tables) {
  test(`browser roles cannot bulk-delete, add schema hooks or maintain ${table}`, async () => {
    for (const privilege of fixture.privileges) {
      for (const role of fixture.roles) {
        const result = await db.query("select has_table_privilege($1,$2,$3) allowed", [role, "public." + table, privilege]);
        assert.equal(result.rows[0].allowed, false, `${role} ${privilege}`);
      }
      const server = await db.query("select has_table_privilege('service_role',$1,$2) allowed", ["public." + table, privilege]);
      assert.equal(server.rows[0].allowed, true, `server ${privilege}`);
    }
  });
}

for (const role of fixture.roles) {
  for (const [label, command] of [
    ["truncate", "truncate public.support_threads"],
    ["trigger creation", "create trigger synthetic_only before update on public.support_threads for each row execute function pg_catalog.suppress_redundant_updates_trigger()"],
    ["foreign-key creation", "create table synthetic.reference (account_id uuid references public.app_users(id))"],
  ]) {
    test(`${role}: ${label} is rejected by PostgreSQL`, async () => {
      await assert.rejects(asIdentity(db, role, ids.other, () => db.exec(command)), { code: "42501" });
    });
  }
}

test("row/column permissions, policies and callable function definitions remain identical", async () => {
  assert.deepEqual(await snapshot(), beforeSnapshot);
});

test("migration is idempotent without changing row-level or server access", async () => {
  const previous = await snapshot();
  await db.exec(migration);
  assert.deepEqual(await snapshot(), previous);
});

test("owners keep private reads and preference CRUD while another account stays isolated", async () => {
  for (const table of ["app_users", "dancer_profiles", "customer_profiles", "support_threads", "notifications"]) {
    assert.equal((await asIdentity(db, "authenticated", ids.owner, () => db.query(`select 1 from public.${quote(table)}`))).rows.length, 1);
  }
  await asIdentity(db, "authenticated", ids.owner, async () => {
    assert.equal((await db.query("delete from public.favorites where customer_id=$1 returning 1", [ids.owner])).rows.length, 1);
    assert.equal((await db.query("insert into public.favorites(customer_id,dancer_id) values($1,$1) returning 1", [ids.owner])).rows.length, 1);
    assert.equal((await db.query("update public.favorites set dancer_id=dancer_id where customer_id=$1 returning 1", [ids.owner])).rows.length, 1);
  });
  assert.equal(await asIdentity(db, "authenticated", ids.other, () => deniedOrEmpty(() => db.query("update public.favorites set dancer_id=$1 where customer_id=$2 returning 1", [ids.other, ids.owner]))), true);
});

test("public profile visibility and hidden legal-name boundaries remain enforced", async () => {
  await db.query("update public.dancer_profiles set status='approved', verification_status='approved', venue_approved_at=now(), is_public=true where id=$1", [ids.owner]);
  try {
    assert.equal((await asIdentity(db, "anon", null, () => db.query("select id from public.public_dancer_profiles where id=$1", [ids.owner]))).rows.length, 1);
    await assert.rejects(asIdentity(db, "anon", null, () => db.query("select real_name from public.dancer_profiles")), { code: "42501" });
  } finally {
    await db.query("update public.dancer_profiles set is_public=false where id=$1", [ids.owner]);
  }
  assert.equal((await asIdentity(db, "anon", null, () => db.query("select id from public.public_dancer_profiles"))).rows.length, 0);
});

const adminCalls = [
  ["void", "select public.void_generated_deal_redemption($1,'synthetic reason') result"],
  ["settle", "select public.settle_deal_revenue_event($1,'venue_payment_received','synthetic reference') result"],
];
for (const [name, sql] of adminCalls) {
  for (const [role, user] of [["anon", null], ["authenticated", null], ["authenticated", ids.other]]) {
    test(`${name}: ${role}/${user ?? "no identity"} cannot invoke the admin operation`, async () => {
      await assert.rejects(asIdentity(db, role, user, async () => {
        await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ user_metadata: { role: "admin" } })]);
        return db.query(sql, [ids.owner]);
      }), { code: "42501" });
    });
  }
  test(`${name}: a disabled administrator is rejected before lookup or mutation`, async () => {
    await db.query("update public.app_users set account_state='disabled' where id=$1", [ids.admin]);
    try {
      await assert.rejects(asIdentity(db, "authenticated", ids.admin, () => db.query(sql, [ids.owner])), { code: "42501" });
    } finally {
      await db.query("update public.app_users set account_state='active' where id=$1", [ids.admin]);
    }
  });
}

test("legitimate admin void and settlement still execute and record their changes", async () => {
  await db.query("update public.qr_redemptions set status='generated' where id=$1", [ids.owner]);
  await db.query("update public.deal_revenue_events set status='pending_venue_payment' where id=$1", [ids.owner]);
  for (const [name, sql] of adminCalls) {
    await asIdentity(db, "authenticated", ids.admin, async () => {
      const result = (await db.query(sql, [ids.owner])).rows[0].result;
      assert.equal(result.status, name === "void" ? "voided" : "settled");
      if (name === "void") {
        const audit = await db.query("select 1 from public.qr_redemption_events where qr_redemption_id=$1 and actor_user_id=$2 and event_type='voided'", [ids.owner, ids.admin]);
        assert.equal(audit.rows.length, 1);
      }
    });
  }
});

test("caller temporary tables cannot shadow the administrator authorization lookup", async () => {
  await asIdentity(db, "authenticated", ids.other, async () => {
    await db.exec("create temporary table app_users(id uuid, role text, account_state text);");
    await db.query("insert into pg_temp.app_users values($1,'admin','active')", [ids.other]);
    assert.equal((await db.query("select public.is_admin() allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select public.current_user_role() role")).rows[0].role, "customer");
  });
});
