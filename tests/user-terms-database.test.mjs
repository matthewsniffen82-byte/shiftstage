import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { USER_TERMS_VERSION as version, USER_TERMS_HREF, USER_TERMS_CONSENT, VIP_USER_TERMS_CONSENT } from "../src/lib/dancr/user-terms-version.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = n => `88888888-1111-4111-8111-${String(n).padStart(12,"0")}`;
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema public,auth to authenticated,service_role;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create table public.vip_access_acceptances(invitation_id uuid,version text,user_id uuid,venue_id uuid,primary key(invitation_id,version));
    insert into auth.users values('${id(1)}','existing@example.test','{}');`);
  await db.exec(read("supabase/migrations/20261008210000_user_terms_acceptance.sql").replace(/\r?\n/g,"\r\n"));
});
after(async () => db?.close());
const prepare = email => db.query("select public.prepare_user_terms_signup($1,$2) token",[email,version]).then(r=>r.rows[0].token);
const signup = (n,email,token) => db.query("insert into auth.users values($1,$2,$3)",[id(n),email,JSON.stringify({role:"customer",user_terms_intent:token})]);

test("User Terms receipts archive exactly the published contract and both checkbox wordings",async()=>{
  const document=JSON.parse(read("src/content/legal/user-terms-2026-10-08-v3.json"));
  const row=(await db.query("select * from public.user_terms_versions where is_current")).rows[0];
  assert.equal(row.version,version);assert.equal(row.terms_href,USER_TERMS_HREF);
  assert.equal(row.document_html,document.html);assert.equal(row.source_sha256,document.sourceSha256);
  assert.equal(row.content_sha256,createHash("sha256").update(document.html).digest("hex"));
  assert.equal(row.consent_text,USER_TERMS_CONSENT);assert.equal(row.vip_consent_text,VIP_USER_TERMS_CONSENT);
  assert.equal((await db.query("select count(*)::int n from public.user_terms_acceptances")).rows[0].n,0);
});

test("new guest identity receives an email-bound, single-use server-time receipt",async()=>{
  const token=await prepare("New@Example.test");
  const intent=(await db.query("select * from public.user_terms_signup_intents where token=$1",[token])).rows[0];
  await signup(2,"new@example.test",token);
  const receipt=(await db.query("select * from public.user_terms_acceptances where user_id=$1",[id(2)])).rows[0];
  assert.equal(receipt.version,version);assert.equal(receipt.acceptance_source,"guest_signup");
  assert.equal(String(receipt.accepted_at),String(intent.accepted_at));
  assert.equal(receipt.consent_text,USER_TERMS_CONSENT);
  await signup(3,"new@example.test",token);
  assert.equal((await db.query("select count(*)::int n from public.user_terms_acceptances where user_id=$1",[id(3)])).rows[0].n,0);
});

test("old versions, wrong email, expired intent, editable metadata and direct signup cannot fabricate acceptance",async()=>{
  await assert.rejects(db.query("select public.prepare_user_terms_signup('a@b.test','old')"),/USER_TERMS_REQUIRED/);
  const token=await prepare("intended@example.test");
  await signup(4,"wrong@example.test",token);
  await db.query("update public.user_terms_signup_intents set expires_at=now()-interval '1 minute' where token=$1",[token]);
  await signup(5,"intended@example.test",token);
  await signup(6,"direct@example.test","invented");
  const existing=await prepare("existing@example.test");
  await db.query("update auth.users set raw_user_meta_data=$1 where id=$2",[JSON.stringify({role:"customer",user_terms_intent:existing,userTermsAccepted:true}),id(1)]);
  assert.equal((await db.query("select count(*)::int n from public.user_terms_acceptances where user_id<>$1",[id(2)])).rows[0].n,0);
});

test("browser and service roles cannot rewrite receipts, and browsers cannot prepare intents",async()=>{
  for(const role of ["anon","authenticated","service_role"]){
    await db.exec(`set role ${role}`);
    try{
      for(const sql of ["delete from public.user_terms_acceptances","update public.user_terms_versions set is_current=false"])
        await assert.rejects(db.exec(sql),/permission denied/);
      if(role!=="service_role")await assert.rejects(prepare("forged@example.test"),/permission denied/);
    }finally{await db.exec("reset role");}
  }
});

test("receipt storage failure rolls back signup rather than losing the acceptance",async()=>{
  const token=await prepare("atomic@example.test");
  await db.exec("create function public.fail_receipt() returns trigger language plpgsql as $$begin raise exception 'receipt failure';end$$;create trigger fail_receipt before insert on public.user_terms_acceptances for each row execute function public.fail_receipt()");
  try{
    await assert.rejects(signup(7,"atomic@example.test",token),/receipt failure/);
    assert.equal((await db.query("select count(*)::int n from auth.users where id=$1",[id(7)])).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int n from public.user_terms_signup_intents where token=$1",[token])).rows[0].n,1);
  }finally{await db.exec("drop trigger fail_receipt on public.user_terms_acceptances;drop function public.fail_receipt()");}
});
