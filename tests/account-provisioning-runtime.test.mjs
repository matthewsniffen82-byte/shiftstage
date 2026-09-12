import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test, { before, after, beforeEach } from "node:test";
import ts from "typescript";
import { isMissingSupabaseFunction } from "../src/lib/supabase/missing-function.ts";
import { createProvisioningDatabase, insertIdentity } from "./helpers/account-provisioning-database.mjs";

const source = readFileSync(new URL("../src/lib/dancr/account-provisioning.ts", import.meta.url), "utf8");
const moduleExports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: moduleExports, Error,
  require(name) {
    if (name === "server-only") return {};
    if (name === "../supabase/missing-function") return { isMissingSupabaseFunction };
    if (name === "./profile-approval") return { initialDancerApprovalValues() { throw new Error("Legacy profile write attempted"); } };
    throw new Error("Unexpected provisioning dependency: " + name);
  },
});
const { provisionAppAccount } = moduleExports;
const id = "72000000-0000-4000-8000-000000000001";
const input = (role = "dancer") => ({ userId: id, role, email: "synthetic@example.test", displayName: "Private real name", city: "" });
let db;
before(async () => {
  db = await createProvisioningDatabase();
  await db.exec(readFileSync(new URL("../supabase/migrations/20260910014900_preserve_existing_account_profiles.sql", import.meta.url), "utf8").replace(/\r\n?/g, "\n"));
});
after(async () => db?.close());
beforeEach(async () => db.exec("reset role; truncate auth.users cascade;"));

function client(outcome) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      assert.equal(name, "provision_app_account_safely");
      if (outcome) return outcome(args);
      const result = await db.query("select public.provision_app_account_safely($1,$2,$3,$4,$5) as acknowledged", [
        args.p_user_id, args.p_role, args.p_email, args.p_display_name, args.p_city,
      ]);
      return { data: result.rows[0].acknowledged, error: null };
    },
    from() { calls.push({ legacy: true }); throw new Error("Non-atomic table access attempted"); },
  };
}
const state = async () => (await db.query(`select
  (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]') from app_users t) as accounts,
  (select coalesce(jsonb_agg(to_jsonb(t) order by user_id), '[]') from customer_profiles t) as customers,
  (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]') from dancer_profiles t) as dancers,
  (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from dancer_profile_slug_aliases t) as aliases`)).rows[0];

for (const role of ["customer", "dancer", "venue", "admin"]) test(`the ${role} caller requires one atomic acknowledgment with unchanged input semantics`, async () => {
  const c = client(async () => ({ data: true, error: null }));
  await provisionAppAccount(c, input(role));
  assert.equal(c.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[0].args)), {
    p_user_id: id, p_role: role, p_email: "synthetic@example.test",
    p_display_name: role === "dancer" ? "Dancer" : "Private real name", p_city: "",
  });
});

for (const code of ["PGRST202", "42883", "57014", "08006", "42501", "23505"]) test(`provisioning error ${code} cannot start non-atomic writes or retry`, async () => {
  const fault = { code, message: "Synthetic provider failure" };
  const c = client(async () => ({ data: null, error: fault }));
  await assert.rejects(provisionAppAccount(c, input()), error => error === fault);
  assert.equal(c.calls.length, 1);
});

for (const ack of [undefined, null, false, 0, "", "true", [], {}]) test(`unconfirmed acknowledgment ${JSON.stringify(ack)} cannot report setup success`, async () => {
  const c = client(async () => ({ data: ack, error: null }));
  await assert.rejects(provisionAppAccount(c, input()), /Account setup could not be confirmed/);
  assert.equal(c.calls.length, 1);
});

test("a thrown transport failure is preserved without automatic retry", async () => {
  const fault = new Error("Synthetic transport failure");
  const c = client(async () => { throw fault; });
  await assert.rejects(provisionAppAccount(c, input()), error => error === fault);
  assert.equal(c.calls.length, 1);
});

test("the caller executes the freshly verified production provisioner", async () => {
  const row = (await db.query("select md5(pg_get_functiondef('public.provision_app_account_safely(uuid,text,text,text,text)'::regprocedure)) as fingerprint")).rows[0];
  assert.equal(row.fingerprint, "4976257073739281a44a64f8a33324f7");
  await insertIdentity(db, id, "dancer", { bootstrap: false });
  const c = client();
  await provisionAppAccount(c, input());
  const profile = (await db.query("select real_name,stage_name,city,status,verification_status,photo_review_status,is_public,approved_at,venue_approved_at from dancer_profiles")).rows[0];
  assert.deepEqual(profile, {
    real_name: "Verification pending", stage_name: "", city: "", status: "draft",
    verification_status: "pending", photo_review_status: "pending", is_public: false,
    approved_at: null, venue_approved_at: null,
  });
  assert.equal((await db.query("select display_name from app_users")).rows[0].display_name, "Dancer");
  assert.equal(c.calls.length, 1);
});

test("repeated signup preserves an approved renamed dancer and every reserved link", async () => {
  await insertIdentity(db, id, "dancer", { bootstrap: false });
  const c = client();
  await provisionAppAccount(c, input());
  await db.query("update dancer_profiles set stage_name='Harper', city='Preserved city', status='approved', is_public=true, approved_at=now(), venue_approved_at=now() where user_id=$1", [id]);
  assert.equal((await db.query("select count(*)::int as n from dancer_profile_slug_aliases")).rows[0].n, 1);
  const before = await state();
  for (let n = 0; n < 3; n++) await provisionAppAccount(c, { ...input(), city: "Replacement city" });
  assert.deepEqual(await state(), before);
  assert.equal(c.calls.length, 4);
});

test("repeated customer signup preserves the established name and city", async () => {
  await insertIdentity(db, id, "customer");
  await db.query("update app_users set display_name='Preserved name' where id=$1", [id]);
  await db.query("update customer_profiles set city='Preserved city' where user_id=$1", [id]);
  const before = await state(), c = client();
  await provisionAppAccount(c, { ...input("customer"), city: "Replacement city" });
  assert.deepEqual(await state(), before);
});

for (const inactive of ["disabled", "deleted"]) test(`signup cannot restore a ${inactive} account or missing profile`, async () => {
  await insertIdentity(db, id);
  await db.query("delete from dancer_profiles where user_id=$1", [id]);
  await db.query("update app_users set account_state=$1 where id=$2", [inactive, id]);
  const before = await state(), c = client();
  await provisionAppAccount(c, input());
  assert.deepEqual(await state(), before);
});

test("a role conflict preserves every existing account and profile row", async () => {
  await insertIdentity(db, id, "customer");
  const before = await state(), c = client();
  await assert.rejects(provisionAppAccount(c, input()), { code: "22023" });
  assert.deepEqual(await state(), before);
  assert.equal(c.calls.length, 1);
});

test("a lost success response leaves one private setup for a later explicit retry", async () => {
  await insertIdentity(db, id, "dancer", { bootstrap: false });
  const committed = client(), fault = { code: "08006" };
  const interrupted = client(async args => { await committed.rpc("provision_app_account_safely", args); return { data: null, error: fault }; });
  await assert.rejects(provisionAppAccount(interrupted, input()), error => error === fault);
  assert.equal(interrupted.calls.length, 1);
  const before = await state();
  assert.equal(before.accounts.length, 1);
  assert.equal(before.dancers.length, 1);
  assert.equal(before.dancers[0].is_public, false);
  await provisionAppAccount(client(), input());
  assert.deepEqual(await state(), before);
  assert.equal((await db.query("select count(*)::int as n from auth.users")).rows[0].n, 1);
});
