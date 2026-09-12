import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError } from "../src/lib/api-error-policy.ts";
import { createPolicyDatabase, asIdentity, ids } from "./helpers/rls-database.mjs";

const oldSql = readFileSync(new URL("../supabase/migrations/202609070003_atomic_accounts_publication_and_metrics.sql", import.meta.url), "utf8")
  .match(/create or replace function public\.transition_dancer_publication_safely\([\s\S]*?grant execute on function public\.transition_dancer_publication_safely\(uuid,text,uuid\) to service_role;/)[0];
const migration = readFileSync(new URL("../supabase/migrations/20260909124600_preserve_admin_profile_suspensions.sql", import.meta.url), "utf8");
async function database(hardened = true) {
  const db = await createPolicyDatabase();
  await db.query("update app_users set role='dancer' where id=$1", [ids.owner]);
  await db.query("update dancer_profiles set status='approved',verification_status='approved',approved_at=now(),venue_approved_at=now(),is_public=true where id=$1", [ids.owner]);
  await db.exec(oldSql);
  if (hardened) await db.exec("begin;" + migration + "commit;");
  return db;
}
async function transition(db, action, actor = ids.owner) {
  const result = await db.query("select transition_dancer_publication_safely($1,$2,$3) as state", [ids.owner, action, actor]);
  return result.rows[0].state;
}
async function snapshot(db) {
  return (await db.query("select status,is_public,disabled_at,admin_disabled_at from dancer_profiles where id=$1", [ids.owner])).rows[0];
}

test("the old publication function reproduces admin suspension bypass through owner reactivation", async () => {
  const db = await database(false);
  try {
    await transition(db, "disable", ids.admin);
    const restored = await transition(db, "reactivate");
    assert.equal(restored.is_public, true);
    assert.equal(restored.status, "approved");
  } finally { await db.close(); }
});

test("admin suspension survives direct reactivation and repeated self-pause/resume", async () => {
  const db = await database();
  try {
    await transition(db, "disable", ids.admin);
    const original = await snapshot(db);
    assert.ok(original.admin_disabled_at);
    for (const action of ["reactivate", "disable", "reactivate", "reactivate"]) {
      const result = await transition(db, action);
      assert.equal(result.status, "disabled");
      assert.equal(result.is_public, false);
      assert.equal((await snapshot(db)).admin_disabled_at.toISOString(), original.admin_disabled_at.toISOString());
      assert.equal(Object.hasOwn(result, "admin_disabled_at"), false);
    }
    await assert.rejects(transition(db, "set_public"), error => error.code === "22023");
    await assert.rejects(transition(db, "submit_for_venue_review"), error => error.code === "42501");
  } finally { await db.close(); }
});

test("only an active admin can clear a moderation suspension; private state stays private during an account pause", async () => {
  const db = await database();
  try {
    await transition(db, "disable"); // Legitimate user pause.
    assert.equal((await snapshot(db)).admin_disabled_at, null);
    assert.equal((await transition(db, "reactivate")).is_public, true);
    await db.query("update app_users set account_state='disabled' where id=$1", [ids.owner]);
    await transition(db, "disable");
    await transition(db, "disable", ids.admin); // Admin acts while the account is paused.
    await assert.rejects(transition(db, "reactivate", ids.admin), error => error.code === "22023");
    await db.query("update app_users set account_state='active' where id=$1", [ids.owner]);
    assert.equal((await transition(db, "reactivate")).is_public, false);
    for (const actor of [ids.other, ids.disabled, null]) await assert.rejects(transition(db, "reactivate", actor), error => error.code === "42501");
    await db.query("update app_users set account_state='disabled' where id=$1", [ids.admin]);
    await assert.rejects(transition(db, "reactivate", ids.admin), error => error.code === "42501");
    await db.query("update app_users set account_state='active' where id=$1", [ids.admin]);
    assert.equal((await transition(db, "reactivate", ids.admin)).is_public, true);
    assert.equal((await snapshot(db)).admin_disabled_at, null);
  } finally { await db.close(); }
});

test("ordinary Supabase sessions cannot call the privileged transition or inspect/change its suspension flag", async () => {
  const db = await database();
  try {
    for (const [role, actor] of [["anon", null], ["authenticated", ids.owner], ["authenticated", ids.other], ["authenticated", ids.admin]]) {
      await assert.rejects(asIdentity(db, role, actor, () => transition(db, "reactivate", ids.admin)), error => error.code === "42501");
      await assert.rejects(asIdentity(db, role, actor, () => db.query("select admin_disabled_at from dancer_profiles")), error => error.code === "42501");
      await assert.rejects(asIdentity(db, role, actor, () => db.query("update dancer_profiles set admin_disabled_at=null")), error => error.code === "42501");
    }
    await asIdentity(db, "service_role", null, async () => assert.equal((await transition(db, "disable", ids.admin)).is_public, false));
    await db.exec("begin;" + migration + "commit;");
  } finally { await db.close(); }
});

test("migration refuses to guess who disabled an existing profile", async () => {
  const db = await database(false);
  try {
    await transition(db, "disable");
    await assert.rejects(db.exec("begin;" + migration + "commit;"), error => error.code === "55000");
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_name='dancer_profiles' and column_name='admin_disabled_at'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("missing publication RPC requires review without another profile read or write", async () => {
  const source = readFileSync(new URL("../src/lib/dancr/profile-publication.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; let calls = 0;
  vm.runInNewContext(code, { exports, Error, require(name) {
    if (name === "../api-error-policy") return { PublicApiError };
    throw new Error(name);
  } });
  const db = { rpc: async () => { calls++; return { error: { code: "PGRST202" } }; },
    from() { assert.fail("An unavailable transaction must not trigger a direct profile operation"); } };
  await assert.rejects(exports.transitionDancerPublication(db, ids.owner, "reactivate", { actorUserId: ids.owner }), error => error.status === 503);
  assert.equal(calls, 1);
});

test("the real account self-service flow cannot restore an administratively suspended profile", async (t) => {
  const { createAccountLifecycleDatabase, seedAccountLifecycle } = await import("./helpers/account-lifecycle-database.mjs");
  const { accountLifecycleCaller } = await import("./helpers/account-lifecycle-caller.mjs");
  const db = await createAccountLifecycleDatabase();
  try {
    const owner = await seedAccountLifecycle(db, { role: "dancer", n: 1 });
    const admin = await seedAccountLifecycle(db, { role: "admin", n: 2 });
    await db.query("select public.transition_dancer_publication_safely($1,'disable',$2)", [owner.dancerId, admin.userId]);
    const client = accountLifecycleCaller({ db, userId: owner.userId });
    for (const state of ["active", "disabled", "active"]) {
      assert.equal((await client.run(state)).accountState, state);
      const profile = (await db.query("select status,is_public,admin_disabled_at from public.dancer_profiles where id=$1", [owner.dancerId])).rows[0];
      assert.equal(profile.status, "disabled"); assert.equal(profile.is_public, false); assert.ok(profile.admin_disabled_at);
    }
    await t.test("a copyright hold after an earlier account read still fences the atomic database change", async () => {
      const profileBefore = (await db.query("select status,is_public,admin_disabled_at from public.dancer_profiles where id=$1", [owner.dancerId])).rows[0];
      const observed = (await db.query("select account_state from public.app_users where id=$1", [owner.userId])).rows[0];
      assert.equal(observed.account_state, "active");
      await db.query("update public.app_users set account_state='disabled',dmca_suspended_at=now()where id=$1", [owner.userId]);
      await assert.rejects(client.run("active"), error => error.status === 403);
      const account = (await db.query("select account_state,dmca_suspended_at from public.app_users where id=$1", [owner.userId])).rows[0];
      assert.equal(account.account_state, "disabled"); assert.ok(account.dmca_suspended_at);
      assert.deepEqual((await db.query("select status,is_public,admin_disabled_at from public.dancer_profiles where id=$1", [owner.dancerId])).rows[0], profileBefore);
    });
  } finally { await db.close(); }
});
