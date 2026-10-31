import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20261031013745_public_safety_privacy_intake.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table content_reports(id uuid primary key default gen_random_uuid(),reporter_id uuid,target_type text,target_id uuid,target_label text,reason text,details text,status text default 'open',reviewed_by uuid,reviewed_at timestamptz,created_at timestamptz default now());
    alter table content_reports enable row level security;
    create table dancer_profiles(id uuid primary key,avatar_storage_path text,avatar_source_storage_path text,avatar_source_photo_id uuid,status text default 'approved',is_public boolean default true);
    create type review_status as enum('pending','approved','rejected');
    create table dancer_photos(id uuid primary key,storage_path text,review_status review_status);
    create table mydancr_tv_videos(id uuid primary key,storage_path text,status text,venue_featured boolean,reviewed_by uuid,reviewed_at timestamptz);
    create table shifts(id uuid primary key,status text);
    create table venues(id uuid primary key,is_active boolean);
    create table admin_actions(id uuid default gen_random_uuid(),admin_id uuid,target_type text,target_id uuid,action text,notes text);
    create function transition_dancer_publication_safely(p_id uuid,p_action text,p_actor uuid) returns jsonb language plpgsql set search_path=public as $$declare result jsonb; begin
      if p_action<>'disable' then raise exception 'Wrong transition'; end if;
      update dancer_profiles set status='disabled',is_public=false where id=p_id returning to_jsonb(dancer_profiles.*) into result;return result;end $$;
    create function change_venue_publication_safely(p_actor uuid,p_id uuid,p_action text,p_changes jsonb) returns jsonb language plpgsql set search_path=public as $$declare result jsonb;begin
      if p_action<>'admin_edit' or p_changes<>'{"is_active":false}' then raise exception 'Wrong transition';end if;
      update venues set is_active=false where id=p_id returning to_jsonb(venues.*) into result;return result;end $$;
    grant all on all tables in schema public to service_role;`);
  await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec('reset role;truncate safety_media_restrictions,content_reports,dancer_profiles,dancer_photos,mydancr_tv_videos,shifts,venues,admin_actions,app_users cascade');
  await db.query("insert into app_users values($1,'admin','active'),($2,'customer','active')",[id(1),id(2)]);
  await db.exec('set role service_role');
});
async function report(type,target=10,extra={}) {
  return (await db.query('insert into content_reports(target_type,target_id,reason,case_kind,intake,priority) values($1,$2,$3,$4,$5,$6) returning *', [type,target?id(target):null,extra.reason||'Other safety concern',extra.kind||'safety',extra.intake||{},extra.priority||'normal'])).rows[0];
}
const close=(r,action='removed',actor=1)=>db.query('select close_public_case($1,$2,$3,$4) receipt',[id(actor),r.id,action,'Synthetic review completed and follow-up recorded.']);
test('server receipt sets an exact 48-hour intimate-image deadline',async()=>{
  const r=await report('contact_message',null,{reason:'Nonconsensual intimate image',priority:'urgent'});
  assert.equal(new Date(r.next_action_due_at)-new Date(r.created_at),48*3600000);
});
test('privacy intake records early review and conditional California response date',async()=>{
  const r=await report('contact_message',null,{kind:'privacy',reason:'Delete my information'});
  assert.equal(new Date(r.next_action_due_at)-new Date(r.created_at),86400000);
  assert.equal(new Date(r.intake.californiaResponseDueAt)-new Date(r.created_at),45*86400000);
});
test('photo removal restricts all stored-file copies and derived avatars and resists reapproval',async()=>{
  await db.query("insert into dancer_photos values($1,'photo/a','approved'),($2,'photo/a','approved'),($3,'unrelated','approved')",[id(10),id(11),id(12)]);
  await db.query("insert into dancer_profiles(id,avatar_storage_path,avatar_source_storage_path,avatar_source_photo_id) values($1,'avatar/a','photo/a',$2)",[id(20),id(10)]);
  const r=await report('profile_photo');const result=(await close(r)).rows[0].receipt;
  assert.equal(result.status,'removed');assert.equal(result.action_evidence.affected.length,2);
  assert.equal((await db.query('select avatar_storage_path from dancer_profiles')).rows[0].avatar_storage_path,null);
  await db.query("update dancer_photos set review_status='approved' where id=$1",[id(10)]);
  assert.equal((await db.query('select review_status from dancer_photos where id=$1',[id(10)])).rows[0].review_status,'rejected');
  await db.query("insert into dancer_photos values($1,'photo/a','approved')",[id(13)]);
  assert.equal((await db.query('select review_status from dancer_photos where id=$1',[id(13)])).rows[0].review_status,'rejected');
  await db.query("update dancer_profiles set avatar_storage_path='avatar/a'");
  assert.equal((await db.query('select avatar_storage_path from dancer_profiles')).rows[0].avatar_storage_path,null);
  await db.query("update dancer_profiles set avatar_storage_path='new-crop',avatar_source_photo_id=$1",[id(10)]);
  assert.equal((await db.query('select avatar_storage_path from dancer_profiles')).rows[0].avatar_storage_path,null);
  assert.equal((await db.query('select review_status from dancer_photos where id=$1',[id(12)])).rows[0].review_status,'approved');
  assert.equal((await db.query('select count(*)::int n from admin_actions')).rows[0].n,1);
});
test('video removal covers reused files without changing unrelated videos',async()=>{
  await db.query("insert into mydancr_tv_videos(id,storage_path,status,venue_featured) values($1,'video/a','approved',true),($2,'video/a','approved',true),($3,'video/b','approved',true)",[id(10),id(11),id(12)]);
  await close(await report('tv_video'));
  const rows=(await db.query('select status,venue_featured from mydancr_tv_videos order by id')).rows;
  assert.deepEqual(rows.map(r=>r.status),['removed','removed','approved']);assert.equal(rows[0].venue_featured,false);
});
test('profile, club and shift removals require actual visibility changes',async()=>{
  await db.query('insert into dancer_profiles(id) values($1)',[id(10)]);
  assert.equal((await close(await report('dancer_profile'))).rows[0].receipt.action_evidence.affected[0].result,'disabled');
  assert.equal((await db.query('select is_public from dancer_profiles')).rows[0].is_public,false);
  await db.query('insert into venues values($1,true)',[id(10)]);
  await close(await report('venue'));
  assert.equal((await db.query('select is_active from venues')).rows[0].is_active,false);
  await db.query("insert into shifts values($1,'posted')",[id(10)]);
  await close(await report('shift'));
  assert.equal((await db.query('select status from shifts')).rows[0].status,'cancelled');
});
test('unbound targets never produce a removed receipt and resolved cases do not remove anything',async()=>{
  const r=await report('contact_message',null);
  await assert.rejects(close(r),/Locate the reported content/);
  assert.equal((await db.query('select status from content_reports')).rows[0].status,'open');
  assert.equal((await close(r,'resolved')).rows[0].receipt.action_evidence.affected.length,0);
  await assert.rejects(close(r,'resolved'),/already closed/);
});
test('missing media and unauthorized actors leave both the case and audit unchanged',async()=>{
  const r=await report('profile_photo');
  await assert.rejects(close(r),/unavailable/);await assert.rejects(close(r,'resolved',2),/administrator/);
  assert.equal((await db.query('select status from content_reports')).rows[0].status,'open');
  assert.equal((await db.query('select count(*)::int n from admin_actions')).rows[0].n,0);
});
test('photo and receipt rollback together if audit persistence fails',async()=>{
  await db.query("insert into dancer_photos values($1,'photo/a','approved')",[id(10)]);
  const r=await report('profile_photo');
  await db.exec('reset role;alter table admin_actions add constraint synthetic_failure check(false);set role service_role');
  try { await assert.rejects(close(r));assert.equal((await db.query('select review_status from dancer_photos')).rows[0].review_status,'approved');assert.equal((await db.query('select status from content_reports')).rows[0].status,'open'); }
  finally {await db.exec('reset role;alter table admin_actions drop constraint synthetic_failure;set role service_role');}
});
for(const role of ['anon','authenticated']) test(`${role} cannot read intake or invoke removal`,async()=>{
  const r=await report('contact_message',null,{intake:{contactEmail:'synthetic@example.invalid'}});
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from safety_media_restrictions'),/permission denied/);
  await assert.rejects(db.query('select * from content_reports'),/permission denied/);
  await assert.rejects(close(r,'resolved'),/permission denied/);
});
