import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DANCER_AGREEMENT_VERSION } from "../src/lib/dancr/dancer-agreement-version.ts";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const original = read("supabase/migrations/20260920032000_dancer_agreement_acceptance.sql");
const previous = read("supabase/migrations/20260923020000_publish_dancer_agreement_v5.sql");
const revision = read("supabase/migrations/20261008200000_publish_revised_dancer_agreement.sql");

test("the October revision preserves both earlier agreements and receipts and requires new assent", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema public,auth to authenticated,service_role;
      create function auth.uid() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create table public.app_users(id uuid primary key references auth.users, role text, account_state text);
      insert into auth.users values(auth.uid(),'existing@example.test','{}');
      insert into public.app_users values(auth.uid(),'dancer','active');`);
    await db.exec(original);
    await db.exec("set role authenticated; select public.accept_dancer_agreement('2026-09-17-v4',true); reset role;");
    await db.exec(previous);
    await db.exec("set role authenticated; select public.accept_dancer_agreement('2026-09-22-v5',true); reset role;");
    const oldReceipts = (await db.query("select * from public.dancer_agreement_acceptances order by version")).rows;
    const oldSnapshots = (await db.query("select * from public.dancer_agreement_versions order by version")).rows;
    // Windows checkouts must archive the same text and hash as production.
    await db.exec(revision.replace(/\r?\n/g, "\r\n"));
    assert.deepEqual((await db.query("select * from public.dancer_agreement_versions where version <> '2026-10-08' order by version")).rows, oldSnapshots.map(row => ({ ...row, is_current: false })));
    assert.deepEqual((await db.query("select * from public.dancer_agreement_acceptances order by version")).rows, oldReceipts);
    const document = JSON.parse(read("src/content/legal/dancer-agreement.json"));
    const current = (await db.query("select * from public.dancer_agreement_versions where is_current")).rows;
    assert.equal(current.length, 1);
    assert.equal(current[0].version, DANCER_AGREEMENT_VERSION);
    assert.equal(current[0].source_sha256, document.sourceSha256);
    assert.equal(current[0].document_html, document.html);
    assert.equal(current[0].content_sha256, createHash("sha256").update(document.html).digest("hex"));
    await db.exec("set role authenticated");
    const access = (await db.query("select public.dancer_agreement_access() as value")).rows[0].value;
    assert.deepEqual(access, { required: true, accepted: false, version: DANCER_AGREEMENT_VERSION, acceptedAt: null });
    await assert.rejects(db.query("select public.accept_dancer_agreement('2026-09-17-v4',true)"), /Accept the current/);
    await assert.rejects(db.query("select public.accept_dancer_agreement('2026-09-22-v5',true)"), /Accept the current/);
    const accepted = (await db.query("select public.accept_dancer_agreement($1,true) as value", [DANCER_AGREEMENT_VERSION])).rows[0].value;
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.version, DANCER_AGREEMENT_VERSION);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as count from public.dancer_agreement_acceptances")).rows[0].count, 3);
    assert.deepEqual((await db.query("select * from public.dancer_agreement_acceptances where version <> '2026-10-08' order by version")).rows, oldReceipts);
    await assert.rejects(db.exec(revision), /Expected v5/);
    await db.exec("rollback");
    assert.equal((await db.query("select version from public.dancer_agreement_versions where is_current")).rows[0].version, DANCER_AGREEMENT_VERSION);
  } finally {
    await db.close();
  }
});
