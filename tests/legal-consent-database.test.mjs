import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create table public.app_users(id uuid primary key,role text,account_state text);
 create table public.dancer_profiles(user_id uuid,status text,disabled_at timestamptz);
 create table public.user_terms_versions(version text primary key,is_current boolean,terms_href text,source_sha256 text,content_sha256 text,document_html text,consent_text text,vip_consent_text text);
 create unique index user_terms_one_current on public.user_terms_versions(is_current) where is_current;
 insert into public.user_terms_versions(version,is_current,document_html) values('old',true,'immutable old user text');
 create table public.dancer_agreement_versions(version text primary key,is_current boolean,source_sha256 text,content_sha256 text,document_html text,consent_text text);
 create unique index dancer_agreement_one_current on public.dancer_agreement_versions(is_current) where is_current;
 insert into public.dancer_agreement_versions(version,is_current,document_html) values('old',true,'immutable old dancer text');
 create table public.dancer_agreement_acceptances(user_id uuid,version text);
 create table public.vip_access_terms_versions(version text primary key,terms_href text,title text,document_text text,notice_text text,consent_text text,privacy_href text);
 create table public.user_terms_acceptances(user_id uuid,version text,acceptance_source text,context_key text,consent_text text,unique(user_id,version,acceptance_source,context_key));
 create table public.vip_access_acceptances(invitation_id uuid,version text,user_id uuid,venue_id uuid,consent_text text,unique(invitation_id,version));
 create table public.venue_vip_invitations(id uuid,token_digest text,accepted_by uuid,venue_id uuid);
 create table public.dancer_age_verifications(user_id uuid primary key,attempt_id uuid default gen_random_uuid(),session_id uuid,provider_integration_id text,status text default 'not_started',verification_url text,created_at timestamptz default now(),expires_at timestamptz,checked_at timestamptz,verified_at timestamptz,attempt_window_at timestamptz default now(),attempt_count integer default 0,provider text);
 grant usage on schema public to anon,authenticated,service_role;
 grant select on all tables in schema public to service_role;
 insert into public.app_users values('${id(1)}','dancer','active'),('${id(2)}','customer','active'),('${id(3)}','dancer','active');
 insert into public.dancer_profiles values('${id(1)}','pending_review',null),('${id(3)}','approved',null);`);
 await db.exec(read('supabase/migrations/20261030232952_legal_package_consent_20261030.sql'));
});
after(async()=>db?.close());
async function service(fn){await db.exec('set role service_role');try{return await fn();}finally{await db.exec('reset role');}}
const request=(n=10,flow='guest_list',action='submit',ref='request',version='2026-10-30',access=null,accepted=true)=>db.query('select public.record_request_terms_acceptance($1,$2,$3,$4,$5,$6,$7) receipt',[id(n),flow,action,ref,version,access,accepted]).then(r=>r.rows[0].receipt);
const consent=(n,user=1,version='2026-10-30',accepted=true)=>db.query('select public.record_dancer_biometric_consent($1,$2,$3,$4) receipt',[id(n),id(user),version,accepted]).then(r=>r.rows[0].receipt);

test('new versions match published immutable documents and preserve historical text',async()=>{
 for(const [table,slug] of [['user_terms_versions','user-terms'],['dancer_agreement_versions','dancer-agreement']]){
  const doc=JSON.parse(read(`src/content/legal/${slug}-2026-10-30.json`));
  const row=(await db.query(`select * from public.${table} where is_current`)).rows[0];
  assert.equal(row.version,'2026-10-30');assert.equal(row.document_html,doc.html);assert.equal(row.source_sha256,doc.sourceSha256);
  assert.equal(row.content_sha256,createHash('sha256').update(doc.html).digest('hex'));
  assert.match((await db.query(`select document_html from public.${table} where version='old'`)).rows[0].document_html,/immutable old/);
 }
 assert.equal((await db.query('select count(*)::int n from public.account_terms_acceptances')).rows[0].n,0);
});
test('request receipts reject unchecked, stale and incomplete combined acceptance',()=>service(async()=>{
 await assert.rejects(request(10,'guest_list','submit','request','2026-10-30',null,false),/REQUIRED/);
 await assert.rejects(request(10,'guest_list','submit','request','old'),/REQUIRED/);
 await assert.rejects(request(10,'table'),/REQUIRED/);
 await assert.rejects(request(10,'ride','cancel'),/REQUIRED/);
 assert.equal((await db.query('select count(*)::int n from public.request_terms_acceptances')).rows[0].n,0);
}));
test('request retries preserve server time and cannot reassign an acceptance to another action',()=>service(async()=>{
 const first=await request();assert.equal(first.id,id(10));assert.ok(Date.parse(first.acceptedAt));
 assert.deepEqual(await request(),first);
 await assert.rejects(request(10,'guest_list','submit','different'),/CONFLICT/);
 const table=await request(11,'table','cancel','table:request','2026-10-30','2026-10-30');assert.equal(table.id,id(11));
 const row=(await db.query('select * from public.request_terms_acceptances where id=$1',[id(11)])).rows[0];
 assert.match(row.consent_text,/User Terms and VIP & Table Access Terms/);
}));
test('biometric consent is separate, requires current contract, and precedes provider reservation',async()=>{
 await assert.rejects(db.query('select public.reserve_dancer_age_verification($1,$2)',[id(1),id(90)]),/BIOMETRIC_CONSENT_REQUIRED/);
 await service(()=>assert.rejects(consent(20),/REQUIRED/));
 await db.query("insert into public.dancer_agreement_acceptances values($1,'2026-10-30')",[id(1)]);
 const receipt=await service(()=>consent(20));assert.equal(receipt.id,id(20));
 await service(async()=>{assert.deepEqual(await consent(20),receipt);await assert.rejects(consent(20,3),/REQUIRED|CONFLICT/);});
 const result=(await db.query('select public.reserve_dancer_age_verification($1,$2) value',[id(1),id(90)])).rows[0].value;
 assert.equal(result.reserved,true);assert.equal(result.notice_version,'2026-10-30');assert.ok(result.consent_at);
 const columns=(await db.query("select column_name from information_schema.columns where table_name='dancer_biometric_consents'")).rows.map(x=>x.column_name);
 assert.deepEqual(columns.sort(),['id','user_id','notice_version','affirmative_action','accepted_at'].sort());
 await db.query('delete from public.dancer_age_verifications where user_id=$1',[id(1)]);
 assert.equal((await db.query('select count(*)::int n from public.dancer_biometric_consents')).rows[0].n,1);
});
test('existing accounts must affirmatively accept; a basic receipt does not grant combined VIP acceptance',()=>service(async()=>{
 const state=async vip=>(await db.query('select public.account_terms_access($1,$2) state',[id(2),vip])).rows[0].state;
 assert.equal((await state(false)).accepted,false);
 await assert.rejects(db.query('select public.accept_current_account_terms($1,$2,$3,$4)',[id(2),'2026-10-30',null,false]),/REQUIRED/);
 await db.query('select public.accept_current_account_terms($1,$2,$3,$4)',[id(2),'2026-10-30',null,true]);
 assert.equal((await state(false)).accepted,true);assert.equal((await state(true)).accepted,false);
 await db.query('select public.accept_current_account_terms($1,$2,$3,$4)',[id(2),'2026-10-30','2026-10-30',true]);
 assert.equal((await state(true)).accepted,true);
}));
test('browser roles cannot access receipts and service callers cannot rewrite evidence',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec(`set role ${role}`);
  try{
   for(const table of ['request_terms_acceptances','dancer_biometric_consents','account_terms_acceptances']){
    await assert.rejects(db.exec(`update public.${table} set accepted_at=now()`),/permission denied/);
    await assert.rejects(db.exec(`delete from public.${table}`),/permission denied/);
    if(role!=='service_role')await assert.rejects(db.exec(`select * from public.${table}`),/permission denied/);
   }
   if(role!=='service_role')await assert.rejects(request(30),/permission denied/);
  }finally{await db.exec('reset role');}
 }
});
