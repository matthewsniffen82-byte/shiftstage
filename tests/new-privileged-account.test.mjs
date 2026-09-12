import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test, { before, after, beforeEach } from "node:test";
import ts from "typescript";
import { createProvisioningDatabase, insertIdentity } from "./helpers/account-provisioning-database.mjs";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/dancr/new-privileged-account.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, Error, require(name) { assert.equal(name, "server-only"); return {}; } });
const reconcile = exports.reconcileNewPrivilegedAccount;
const id = "84000000-0000-4000-8000-000000000001";
const other = "84000000-0000-4000-8000-000000000002";
const identity = role => ({ id, app_metadata: { mydancr_provisioned_role: role } });
let db;
before(async () => { db = await createProvisioningDatabase(); });
after(async () => db?.close());
beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade;");
  await insertIdentity(db, id, "customer");
  await insertIdentity(db, other, "customer");
});

function client(fault) {
  const calls = [];
  return { calls, from(table) {
    assert.ok(["app_users", "customer_profiles"].includes(table));
    let action, values, columns;
    const filters = [];
    const builder = {
      update(input) { action = "update"; values = input; return builder; },
      delete() { action = "delete"; return builder; },
      select(input) { action = "select"; columns = input; return builder; },
      eq(key, value) { assert.ok(["id", "user_id", "role", "account_state"].includes(key)); filters.push([key, value]); return builder; },
      maybeSingle() { return execute(); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    async function execute() {
      calls.push({ table, action, filters });
      if (fault?.action === action) return { data: null, error: fault.error };
      if (action === "select" && fault && "receipt" in fault) return { data: fault.receipt, error: null };
      const args = action === "update" ? [values.role] : [];
      const where = filters.map(([key, value]) => { args.push(value); return `${key} = $${args.length}`; }).join(" and ");
      assert.ok(where, "Every operation must target the new identity");
      if (action === "select") assert.equal(columns, "id,role,account_state");
      const statement = action === "update" ? `update ${table} set role = $1` : action === "delete" ? `delete from ${table}` : `select ${columns} from ${table}`;
      const result = await db.query(`${statement} where ${where}`, args);
      return { data: result.rows[0] || null, error: null };
    }
    return builder;
  } };
}
const snapshot = async () => (await db.query("select (select jsonb_agg(to_jsonb(a) order by id) from app_users a) accounts, (select jsonb_agg(to_jsonb(c) order by user_id) from customer_profiles c) customers")).rows[0];

for (const role of ["admin", "venue"]) {
  test(`${role} signup reconciles delayed trusted metadata and preserves the unrelated customer`, async () => {
    const c = client();
    await reconcile(c, identity(role), role);
    assert.equal((await db.query("select role from app_users where id=$1", [id])).rows[0].role, role);
    assert.deepEqual((await db.query("select user_id from customer_profiles")).rows, [{ user_id: other }]);
    assert.equal((await db.query("select role from app_users where id=$1", [other])).rows[0].role, "customer");
    assert.deepEqual(c.calls[0].filters, [["id", id], ["role", "customer"], ["account_state", "active"]]);
  });
  test(`${role} signup also accepts a trigger that saved the privileged role before returning`, async () => {
    await db.query("update app_users set role=$1 where id=$2", [role, id]);
    await reconcile(client(), identity(role), role);
    assert.equal((await db.query("select role from app_users where id=$1", [id])).rows[0].role, role);
  });
}

for (const metadata of [undefined, {}, { role: "admin" }, { mydancr_provisioned_role: "venue" }]) test("untrusted or mismatched admin metadata causes no database access", async () => {
  const c = client();
  await assert.rejects(reconcile(c, { id, app_metadata: metadata }, "admin"), /Trusted account role/);
  assert.equal(c.calls.length, 0);
});

test("a different authoritative account type is never promoted", async () => {
  await db.query("update app_users set role='venue' where id=$1", [id]);
  const previous = await snapshot();
  await assert.rejects(reconcile(client(), identity("admin"), "admin"), /could not be confirmed/);
  assert.deepEqual(await snapshot(), previous);
});

test("an inactive placeholder is never promoted or cleaned up", async () => {
  const states = (await db.query("select unnest(enum_range(null::public.account_state))::text as state")).rows;
  for (const { state } of states.filter(row => row.state !== "active")) {
    await db.query("update app_users set account_state=$1 where id=$2", [state, id]);
    const previous = await snapshot();
    await assert.rejects(reconcile(client(), identity("admin"), "admin"), /could not be confirmed/);
    assert.deepEqual(await snapshot(), previous);
  }
});

test("a missing identity cannot acknowledge setup", async () => {
  await db.query("delete from auth.users where id=$1", [id]);
  const previous = await snapshot();
  await assert.rejects(reconcile(client(), identity("admin"), "admin"), /could not be confirmed/);
  assert.deepEqual(await snapshot(), previous);
});

for (const receipt of [null, {}, { id: other, role: "admin", account_state: "active" }, { id, role: "admin" }, { id, role: "customer", account_state: "active" }]) {
  test("missing or malformed account confirmation never authorizes placeholder deletion", async () => {
    const c = client({ receipt });
    await assert.rejects(reconcile(c, identity("admin"), "admin"), /could not be confirmed/);
    assert.equal(c.calls.some(call => call.action === "delete"), false);
    assert.equal((await db.query("select user_id from customer_profiles where user_id=$1", [id])).rows.length, 1);
  });
}

for (const action of ["update", "select", "delete"]) test(`${action} failure is propagated without continuing account setup`, async () => {
  const fault = new Error("synthetic database fault");
  const c = client({ action, error: fault });
  await assert.rejects(reconcile(c, identity("admin"), "admin"), error => error === fault);
  assert.equal(c.calls.at(-1).action, action);
  assert.equal(c.calls.filter(call => call.action === action).length, 1);
});
