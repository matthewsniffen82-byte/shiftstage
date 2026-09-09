import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { asIdentity, catalog, createPolicyDatabase, deniedOrEmpty, ids, preferenceTables, quote, tables } from "./helpers/rls-database.mjs";

let db;
before(async () => { db = await createPolicyDatabase(); });
after(async () => { await db?.close(); });

for (const table of tables) {
  test(`RLS: anonymous and unrelated user cannot access or mutate private ${table.name} records`, async () => {
    const columns = catalog.columns.filter(c => c.table_schema === "public" && c.table_name === table.name);
    const owner = columns.find(c => c.udt_name === "uuid");
    const predicate = owner ? `${quote(owner.column_name)}='${ids.owner}'` : "true";
    const target = `public.${quote(table.name)}`;
    for (const [role, user] of [["anon", null], ["authenticated", ids.other]]) {
      for (const sql of [
        `select 1 from ${target} where ${predicate}`,
        `update ${target} set ${quote(columns[0].column_name)}=${quote(columns[0].column_name)} where ${predicate} returning 1`,
        `delete from ${target} where ${predicate} returning 1`,
        `insert into ${target} (${quote(columns[0].column_name)}) values (${columns[0].udt_name === "uuid" ? `'${ids.owner}'` : "null"}) returning 1`,
      ]) {
        assert.equal(await asIdentity(db, role, user, () => deniedOrEmpty(() => db.query(sql))), true, `${role}: ${sql.split(" ")[0]}`);
      }
    }
  });
}

test("RLS: owners retain their profile, preferences and private support reads", async () => {
  for (const table of ["app_users", "customer_profiles", "dancer_profiles", "favorites", "follows", "going_signals", "venue_follows", "support_threads", "support_messages", "notifications"]) {
    const result = await asIdentity(db, "authenticated", ids.owner, () => db.query(`select 1 from public.${quote(table)}`));
    assert.equal(result.rows.length, 1, table);
  }
});

test("RLS: account roles and dancer approval cannot be changed by a customer", async () => {
  for (const sql of ["update app_users set role='admin'", "update dancer_profiles set status='approved'", "insert into dancer_profiles(user_id) values ('" + ids.owner + "')"]) {
    assert.equal(await asIdentity(db, "authenticated", ids.owner, () => deniedOrEmpty(() => db.query(sql))), true);
  }
});

test("RLS: an active admin has access and user-controlled metadata cannot create it", async () => {
  const authorized = await asIdentity(db, "authenticated", ids.admin, () => db.query("select 1 from admin_actions"));
  assert.equal(authorized.rows.length, 1);
  await asIdentity(db, "authenticated", ids.other, async () => {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: ids.other, role: "authenticated", user_metadata: { role: "admin" } })]);
    assert.equal((await db.query("select is_admin() as allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select 1 from admin_actions")).rows.length, 0);
  });
  await db.query("update app_users set account_state='disabled' where id=$1", [ids.admin]);
  assert.equal((await asIdentity(db, "authenticated", ids.admin, () => db.query("select 1 from admin_actions"))).rows.length, 0);
  await db.query("update app_users set account_state='active' where id=$1", [ids.admin]);
});

test("RLS: the private analytics view and legal name remain inaccessible", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const sql of ["select * from dancer_monthly_impact", "select real_name from dancer_profiles"]) {
      assert.equal(await asIdentity(db, role, ids.other, () => deniedOrEmpty(() => db.query(sql))), true);
    }
    assert.equal((await asIdentity(db, role, ids.other, () => db.query("select 1 from public_dancer_profiles"))).rows.length, 0);
  }
});

test("RLS: publishing and hiding a profile preserves the intended anonymous visibility", async () => {
  await db.query("update dancer_profiles set status='approved', verification_status='approved', venue_approved_at=now(), is_public=true where id=$1", [ids.owner]);
  try {
    for (const table of ["dancer_profiles", "public_dancer_profiles"]) {
      assert.equal((await asIdentity(db, "anon", null, () => db.query(`select id from ${table} where id=$1`, [ids.owner]))).rows.length, 1);
    }
    await db.query("update dancer_profiles set is_public=false where id=$1", [ids.owner]);
    assert.equal((await asIdentity(db, "anon", null, () => db.query("select id from public_dancer_profiles"))).rows.length, 0);
  } finally {
    await db.query("update dancer_profiles set status=null, verification_status=null, venue_approved_at=null, is_public=false where id=$1", [ids.owner]);
  }
});

function preferenceInsert(table) {
  const key = table === "customer_profiles" ? "user_id" : "customer_id";
  const targetKey = ["follows", "favorites"].includes(table) ? "dancer_id" : table === "going_signals" ? "shift_id" : table === "venue_follows" ? "venue_id" : null;
  return `insert into public.${quote(table)} (${key}${targetKey ? `,${targetKey}` : ""}) values ($1${targetKey ? `,'${ids.owner}'` : ""}) returning 1`;
}
for (const table of preferenceTables) {
  test(`RLS: active owners can use ${table} while ownership transfer stays blocked`, async () => {
    const key = table === "customer_profiles" ? "user_id" : "customer_id";
    const target = `public.${quote(table)}`;
    await asIdentity(db, "authenticated", ids.owner, async () => {
      await db.query(`delete from ${target} where ${key}=$1`, [ids.owner]);
      assert.equal((await db.query(preferenceInsert(table), [ids.owner])).rows.length, 1);
      assert.ok((await db.query(`update ${target} set ${key}=${key} where ${key}=$1 returning 1`, [ids.owner])).rows.length > 0);
    });
    assert.equal(await asIdentity(db, "authenticated", ids.owner, () => deniedOrEmpty(() => db.query(
      `update ${target} set ${key}=$1 where ${key}=$2 returning 1`, [ids.other, ids.owner],
    ))), true);
  });
  test(`RLS: disabled accounts cannot create or change ${table}`, async () => {
    const key = table === "customer_profiles" ? "user_id" : "customer_id";
    const target = `public.${quote(table)}`;
    assert.equal(await asIdentity(db, "authenticated", ids.disabled, () => deniedOrEmpty(() => db.query(
      preferenceInsert(table), [ids.disabled],
    ))), true, "disabled insert rejected");
    await db.query(preferenceInsert(table), [ids.disabled]);
    try {
      assert.equal(await asIdentity(db, "authenticated", ids.disabled, () => deniedOrEmpty(() => db.query(
        `update ${target} set ${key}=${key} where ${key}=$1 returning 1`, [ids.disabled],
      ))), true, "disabled update rejected");
      await asIdentity(db, "authenticated", ids.disabled, async () => {
        assert.equal((await db.query(`select 1 from ${target} where ${key}=$1`, [ids.disabled])).rows.length, 1);
        assert.equal((await db.query(`delete from ${target} where ${key}=$1 returning 1`, [ids.disabled])).rows.length, 1);
      });
    } finally {
      await db.query(`delete from ${target} where ${key}=$1`, [ids.disabled]);
    }
  });
}
