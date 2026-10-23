import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(read('tests/gallery-publication-postgres.test.mjs').match(/const schema = `([\s\S]*?)`;/)[1]);
  await db.exec(read('supabase/migrations/20260909203842_add_atomic_gallery_publication.sql'));
  await db.exec(`create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    alter table app_users add column display_name text,add column email text;
    alter table app_users enable row level security;
    grant select,update on app_users to authenticated;
    create policy original_self on app_users for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
    alter table dancer_profiles add column stage_name text default 'Test dancer',add column status text default 'draft',add column verification_status text default 'pending',add column approved_at timestamptz,add column venue_approved_at timestamptz;
    alter table image_moderation_records add column avatar_expected_path text,add column avatar_expected_updated_at timestamptz,add column venue_media_context jsonb;
    create table venues(id uuid primary key,owner_user_id uuid,name text);
    create table venue_team_members(venue_id uuid,user_id uuid,role text,status text);
    create table venue_dancer_affiliations(id uuid default gen_random_uuid(),venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz,updated_at timestamptz default now());
    create table nfc_tags(id uuid primary key,status text);
    create table dancer_nfc_enrollments(id uuid default gen_random_uuid(),dancer_user_id uuid,venue_id uuid,nfc_tag_id uuid,status text,expires_at timestamptz,created_at timestamptz default now());
    create table mydancr_tv_videos(id uuid primary key,dancer_id uuid,submitted_by uuid,status text,reviewed_by uuid,upload_validation_pending boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
    create table admin_actions(id uuid default gen_random_uuid(),admin_id uuid,action text,target_type text,target_id uuid,notes text);
    grant all on all tables in schema public to service_role;`);
  await db.exec(read('supabase/migrations/20261020224618_venue_dancer_media_review.sql'));
  await db.exec(`alter table mydancr_tv_videos add column moderation_decision text,add column moderation_completed_at timestamptz,
    add column moderation_reason_codes text[] default '{}',add column moderation_details jsonb default '{}',add column reviewed_at timestamptz,
    add column published_at timestamptz,add column expires_at timestamptz,add column venue_featured boolean default false,
    add column storage_path text default 'test/video.mp4',add column storage_mime text default 'video/mp4',add column caption text,
    add column width int default 720,add column height int default 1280,add column duration_seconds numeric default 10,
    add column moderation_attempt_count int default 0,add column moderation_started_at timestamptz,add column venue_id uuid,add column review_notes text;`);
  await db.exec(read('supabase/migrations/20261023025136_human_media_approval.sql'));
  await db.exec(read('supabase/migrations/20261023042742_admin_operations_workspace.sql'));
});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec('reset role;truncate app_users,auth.users,dancer_profiles,image_moderation_records,mydancr_tv_videos,venues,venue_dancer_affiliations,admin_actions,admin_media_review_events,admin_review_claims cascade');
  for(const [n,role,scope] of [[1,'dancer','owner'],[2,'venue','owner'],[3,'admin','owner'],[4,'admin','reviewer'],[5,'admin','support'],[6,'admin','billing']]) {
    await db.query('insert into auth.users values($1)',[id(n)]);
    await db.query('insert into app_users(id,role,admin_workspace_role) values($1,$2,$3)',[id(n),role,scope]);
  }
  await db.query('insert into dancer_profiles(id,user_id) values($1,$2)',[id(10),id(1)]);
  await db.query("insert into venues values($1,$2,'Test club')",[id(20),id(2)]);
  await db.query("insert into venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$2,'active')",[id(20),id(10)]);
  await db.exec('set role service_role');
});
async function upload(n=100){
  await db.query(`insert into image_moderation_records(id,user_id,upload_context,decision,status,temporary_storage_path,category_flags)
    values($1,$2,'profile_gallery:1','review','pending_review','private/test','{"file_checks_passed":true}')`,[id(n),id(1)]);
  return (await db.query('select * from image_moderation_records where id=$1',[id(n)])).rows[0];
}
async function club(r){return (await db.query("select review_club_dancer_media($1,$2,'photo',$3,$4,'Reviewed by club') result",[id(2),id(20),r.id,r.updated_at])).rows[0].result;}
const claim=(r,actor=4)=>db.query("select claim_admin_media($1,'photo',$2,$3)",[id(actor),r.id,r.updated_at]);
async function publish(r,actor=4){
  const path=`${id(1)}/${id(10)}/${r.id}.jpg`;
  await db.query("insert into storage.objects values('dancer-photos',$1) on conflict do nothing",[path]);
  return (await db.query("select publish_approved_dancer_gallery_photo($1,$2,$3,'[]','{}','{}',false,null,$4,'Final review') result",[r.id,r.updated_at,path,id(actor)])).rows[0].result;
}
test('club-first queue, exclusive reviewer claim, atomic publication and full audit history',async()=>{
  const uploadRow=await upload();
  assert.equal((await db.query('select stage from admin_media_workspace')).rows[0].stage,'club');
  await assert.rejects(claim(uploadRow),e=>e.code==='40001');
  const r=await club(uploadRow);
  assert.equal((await db.query('select stage from admin_media_workspace')).rows[0].stage,'staff');
  await assert.rejects(publish(r),e=>e.code==='40001');
  await claim(r);
  await assert.rejects(claim(r,3),e=>e.code==='40001');
  assert.equal((await publish(r)).record.decision,'approved');
  const events=(await db.query('select stage,decision,actor_id,notes from admin_media_review_events order by id')).rows;
  assert.deepEqual(events.map(e=>[e.stage,e.decision,e.actor_id]),[['club','approved',id(2)],['mydancr','approved',id(4)]]);
  assert.equal((await db.query('select count(*) n from admin_review_claims')).rows[0].n,0);
});
test('support and billing cannot claim or approve; stale versions and expired leases cannot publish',async()=>{
  const r=await club(await upload());
  for(const actor of [5,6])await assert.rejects(claim(r,actor),e=>e.code==='42501');
  await assert.rejects(claim({...r,updated_at:'2000-01-01'}),e=>e.code==='40001');
  await claim(r);await db.exec("update admin_review_claims set expires_at=now()-interval '1 minute'");
  await assert.rejects(publish(r),e=>e.code==='40001');await claim(r,3);assert.equal((await publish(r,3)).record.decision,'approved');
});
test('restricted staff cannot bypass API scopes through RLS or owner helpers',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(5)]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select count(*) n from app_users')).rows[0].n,1);
  assert.equal((await db.query('select is_admin() value')).rows[0].value,false);
  assert.equal((await db.query('select pickup_actor_role() value')).rows[0].value,null);
  await assert.rejects(db.query('select * from admin_media_workspace'),e=>e.code==='42501');
  await assert.rejects(db.query("select claim_admin_media($1,'photo',$2,now())",[id(3),id(100)]),e=>e.code==='42501');
  await db.query("update app_users set admin_workspace_role='owner' where id=$1",[id(5)]);
  assert.equal((await db.query('select admin_workspace_role from app_users')).rows[0].admin_workspace_role,'support');
});
test('only an owner can change another staff role; self-demotion cannot remove the final owner',async()=>{
  await assert.rejects(db.query("select set_admin_workspace_role($1,$2,'owner')",[id(5),id(5)]),e=>e.code==='42501');
  await assert.rejects(db.query("select set_admin_workspace_role($1,$1,'support')",[id(3)]),e=>e.code==='22023');
  await db.query("select set_admin_workspace_role($1,$2,'billing')",[id(3),id(5)]);
  assert.equal((await db.query('select admin_workspace_role from app_users where id=$1',[id(5)])).rows[0].admin_workspace_role,'billing');
  assert.equal((await db.query('select count(*) n from admin_actions')).rows[0].n,1);
});
