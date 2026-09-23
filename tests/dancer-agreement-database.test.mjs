import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DANCER_AGREEMENT_VERSION as version } from "../src/lib/dancr/dancer-agreement-version.ts";

let db;
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const migration = readFileSync(new URL("../supabase/migrations/20260920032000_dancer_agreement_acceptance.sql", import.meta.url), "utf8");
const revision = readFileSync(new URL("../supabase/migrations/20260923020000_publish_dancer_agreement_v5.sql", import.meta.url), "utf8");
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to authenticated,service_role;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create table public.app_users(id uuid primary key references auth.users, role text, account_state text);
    insert into auth.users(id,email) values('${id(1)}','existing@example.test'),('${id(2)}','customer@example.test'),('${id(3)}','paused@example.test');
    insert into public.app_users values('${id(1)}','dancer','active'),('${id(2)}','customer','active'),('${id(3)}','dancer','disabled');`);
  await db.exec(migration);
  await db.exec(revision);
});
after(async () => db?.close());
async function asUser(n, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const access = () => db.query("select public.dancer_agreement_access() as value").then(r => r.rows[0].value);
const accept = (v = version, accepted = true) => db.query("select public.accept_dancer_agreement($1,$2) as value", [v, accepted]).then(r => r.rows[0].value);
const intent = email => db.query("select public.prepare_dancer_agreement_signup($1,$2) as token", [email, version]).then(r => r.rows[0].token);

test("deployment keeps existing users unaccepted and archives the exact published agreement", async () => {
  const original = JSON.parse(readFileSync(new URL("../src/content/legal/dancer-agreement.json", import.meta.url), "utf8"));
  const row = (await db.query("select * from public.dancer_agreement_versions where is_current")).rows[0];
  assert.equal(row.document_html, original.html);
  assert.equal(row.source_sha256, original.sourceSha256);
  assert.equal(row.content_sha256, createHash("sha256").update(original.html).digest("hex"));
  assert.equal(row.consent_text, "I agree to the Dancer Agreement.");
  assert.deepEqual(await asUser(1, access), { required: true, accepted: false, acceptedAt: null, version });
});

test("unchecked, stale, wrong-role and paused requests cannot create acceptance", async () => {
  await asUser(1, async () => {
    for (const checked of [false, null]) await assert.rejects(accept(version, checked), /Accept the current/);
    await assert.rejects(accept("old-version"), /Accept the current/);
  });
  for (const n of [2, 3]) await asUser(n, () => assert.rejects(accept(), /active dancer/));
  assert.equal((await db.query("select count(*)::int as n from public.dancer_agreement_acceptances")).rows[0].n, 0);
});

test("verified dancers accept only for themselves with a durable server timestamp and idempotent retries", async () => {
  const first = await asUser(1, accept);
  assert.equal(first.accepted, true);
  assert.ok(Number.isFinite(Date.parse(first.acceptedAt)));
  assert.deepEqual(await asUser(1, accept), first);
  const rows = (await db.query("select user_id,version,acceptance_source from public.dancer_agreement_acceptances")).rows;
  assert.deepEqual(rows, [{ user_id: id(1), version, acceptance_source: "dashboard" }]);
});

test("browser roles cannot forge, rewrite or delete receipts or prepare signup intents", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      for (const sql of ["select * from public.dancer_agreement_acceptances", "delete from public.dancer_agreement_acceptances", "update public.dancer_agreement_versions set is_current=false", `select public.prepare_dancer_agreement_signup('other@example.test','${version}')`]) {
        await assert.rejects(db.exec(sql), /permission denied/);
      }
    } finally { await db.exec("reset role"); }
  }
});

test("new signup binds the receipt to the newly inserted identity, email, version and original server time", async () => {
  const token = await intent("New@Example.test");
  const pending = (await db.query("select accepted_at from public.dancer_agreement_signup_intents where token=$1", [token])).rows[0];
  await db.query("insert into auth.users values($1,$2,$3)", [id(4), "new@example.test", JSON.stringify({ role: "dancer", dancer_agreement_intent: token })]);
  const receipt = (await db.query("select * from public.dancer_agreement_acceptances where user_id=$1", [id(4)])).rows[0];
  assert.equal(receipt.version, version);
  assert.equal(receipt.acceptance_source, "signup");
  assert.equal(String(receipt.accepted_at), String(pending.accepted_at));
  assert.equal((await db.query("select count(*)::int as n from public.dancer_agreement_signup_intents where token=$1", [token])).rows[0].n, 0);
  await db.query("insert into auth.users values($1,$2,$3)", [id(9), "new@example.test", JSON.stringify({ role: "dancer", dancer_agreement_intent: token })]);
  assert.equal((await db.query("select count(*)::int as n from public.dancer_agreement_acceptances where user_id=$1", [id(9)])).rows[0].n, 0);
});

test("repeated signup and editable metadata never accept terms for an existing account", async () => {
  const token = await intent("paused@example.test");
  await db.query("update auth.users set raw_user_meta_data=$1 where id=$2", [JSON.stringify({ role: "dancer", dancer_agreement_intent: token, agreementAccepted: true }), id(3)]);
  assert.equal((await db.query("select count(*)::int as n from public.dancer_agreement_acceptances where user_id=$1", [id(3)])).rows[0].n, 0);
});

test("wrong email, expired intent and invented metadata cannot create receipts", async () => {
  const token = await intent("intended@example.test");
  await db.query("insert into auth.users values($1,$2,$3)", [id(5), "wrong@example.test", JSON.stringify({ role: "dancer", dancer_agreement_intent: token })]);
  await db.query("update public.dancer_agreement_signup_intents set expires_at=now()-interval '1 minute' where token=$1", [token]);
  await db.query("insert into auth.users values($1,$2,$3)", [id(6), "intended@example.test", JSON.stringify({ role: "dancer", dancer_agreement_intent: token })]);
  await db.query("insert into auth.users values($1,$2,$3)", [id(7), "forged@example.test", JSON.stringify({ role: "dancer", agreementAccepted: true, dancer_agreement_intent: "not-a-token" })]);
  assert.equal((await db.query("select count(*)::int as n from public.dancer_agreement_acceptances where user_id=any($1)", [[id(5), id(6), id(7)]])).rows[0].n, 0);
});

test("receipt failure rolls back the signup identity instead of silently losing acceptance", async () => {
  const token = await intent("atomic@example.test");
  await db.exec("create function public.fail_receipt() returns trigger language plpgsql as $$begin raise exception 'synthetic receipt failure';end$$; create trigger fail_receipt before insert on public.dancer_agreement_acceptances for each row execute function public.fail_receipt()");
  try {
    await assert.rejects(db.query("insert into auth.users values($1,$2,$3)", [id(8), "atomic@example.test", JSON.stringify({ role: "dancer", dancer_agreement_intent: token })]), /synthetic receipt failure/);
    assert.equal((await db.query("select count(*)::int as n from auth.users where id=$1", [id(8)])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from public.dancer_agreement_signup_intents where token=$1", [token])).rows[0].n, 1);
  } finally { await db.exec("drop trigger fail_receipt on public.dancer_agreement_acceptances;drop function public.fail_receipt()"); }
});
