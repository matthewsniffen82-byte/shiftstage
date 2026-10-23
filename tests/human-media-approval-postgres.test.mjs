import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261020224618_venue_dancer_media_review.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
before(async () => {
  db = new PGlite();
  // Reuse the atomic gallery fixture's actual typed tables and storage constraints.
  const schema = read('tests/gallery-publication-postgres.test.mjs').match(/const schema = `([\s\S]*?)`;/)[1];
  await db.exec(schema);
  await db.exec(read('supabase/migrations/20260909203842_add_atomic_gallery_publication.sql'));
  await db.exec(`alter table dancer_profiles add column stage_name text default 'Synthetic dancer', add column status text default 'draft',
    add column verification_status text default 'pending', add column approved_at timestamptz, add column venue_approved_at timestamptz;
    alter table image_moderation_records add column avatar_expected_path text, add column avatar_expected_updated_at timestamptz;
    create table venues(id uuid primary key, owner_user_id uuid);
    create table venue_team_members(venue_id uuid,user_id uuid,role text,status text);
    create table venue_dancer_affiliations(id uuid default gen_random_uuid(),venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz);
    create table nfc_tags(id uuid primary key,status text);
    create table dancer_nfc_enrollments(id uuid default gen_random_uuid(),dancer_user_id uuid,venue_id uuid,nfc_tag_id uuid,status text,expires_at timestamptz);
    create table mydancr_tv_videos(id uuid primary key,dancer_id uuid,submitted_by uuid,status text,reviewed_by uuid,
      upload_validation_pending boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
    grant all on all tables in schema public to service_role;`);
  await db.exec(migration);
  await db.exec(`alter table mydancr_tv_videos add column moderation_decision text,
    add column moderation_completed_at timestamptz, add column moderation_reason_codes text[] default '{}',
    add column moderation_details jsonb default '{}', add column reviewed_at timestamptz,
    add column published_at timestamptz, add column expires_at timestamptz, add column venue_featured boolean default false;`);
  await db.exec(`alter table mydancr_tv_videos add column storage_path text default 'private/video.mp4', add column storage_mime text default 'video/mp4',
    add column caption text default 'Synthetic video', add column width integer default 720, add column height integer default 1280,
    add column duration_seconds numeric default 10, add column moderation_attempt_count integer default 0, add column moderation_started_at timestamptz;`);
  await db.exec(read('supabase/migrations/20261023025136_human_media_approval.sql'));
  await db.exec(read('supabase/migrations/20261023054159_venue_media_dancer_grid.sql'));
  await db.exec('create trigger test_submission before insert or update of status,verification_status,venue_approved_at on dancer_profiles for each row execute function enforce_dancer_onboarding_photos()');
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('reset role;truncate dancer_nfc_enrollments,venue_dancer_affiliations,venue_team_members,nfc_tags,venues,mydancr_tv_videos,dancer_photos,image_moderation_records,dancer_profiles,app_users,auth.users,storage.objects cascade');
  for (const [n, role] of [[1,'dancer'],[2,'venue'],[3,'venue'],[4,'venue'],[5,'venue'],[6,'admin']]) {
    await db.query('insert into auth.users values($1)', [id(n)]);
    await db.query('insert into app_users(id,role) values($1,$2)',[id(n),role]);
  }
  await db.query('insert into dancer_profiles(id,user_id) values($1,$2)',[id(10),id(1)]);
  await db.query('insert into venues values($1,$2),($3,$4)',[id(20),id(2),id(21),id(3)]);
  await db.query("insert into venue_team_members values($1,$2,'manager','active'),($1,$3,'staff','active')",[id(20),id(4),id(5)]);
  await db.query("insert into nfc_tags values($1,'active')",[id(30)]);
  await db.exec('set role service_role');
});
async function upload(n, context='profile_gallery:1', extra={}) {
  const record = { id:id(n),user_id:id(1),upload_context:context,decision:'review',status:'pending_review',temporary_storage_path:'private/'+n,updated_at:'2026-01-01T00:00:00Z',...extra };
  await db.query(`insert into image_moderation_records(id,user_id,upload_context,decision,status,temporary_storage_path,updated_at,photo_publication_mode,replacement_photo_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[record.id,record.user_id,context,record.decision,record.status,record.temporary_storage_path,record.updated_at,extra.photo_publication_mode||'add',extra.replacement_photo_id||null]);
  await db.query(`update image_moderation_records set category_flags='{"file_checks_passed":true}' where id=$1`, [record.id]);
  return record;
}
const tap = () => db.query("insert into dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id,status,expires_at) values($1,$2,$3,'pending',now()+interval '7 days')",[id(1),id(20),id(30)]);
const authorize = (actor=2, venue=20) => db.query('select assert_dancer_media_reviewer($1,$2,$3)',[id(actor),id(1),id(venue)]);
const queue = async (actor=2,venue=20,offset=0,limit=12) => (await db.query('select get_venue_dancer_media_review($1,$2,$3,$4) value',[id(actor),id(venue),offset,limit])).rows[0].value;
const grid = async (dancer=null,offset=0,limit=12,actor=2,venue=20) => (await db.query('select get_venue_dancer_media_grid($1,$2,$3,$4,$5) value',[id(actor),id(venue),dancer===null?null:id(dancer),offset,limit])).rows[0].value;
async function publish(record,actor=2) {
  const path = `${id(1)}/${id(10)}/${record.id}.jpg`;
  await db.query("insert into storage.objects values('dancer-photos',$1) on conflict do nothing",[path]);
  return (await db.query("select publish_approved_dancer_gallery_photo($1,$2,$3,'[]','{}','{}',false,null,$4,'Reviewed') value",[record.id,record.updated_at,path,actor===null?null:id(actor)])).rows[0].value;
}
const forbidden = error => error.code==='42501';

const changed = error => ['40001','42501'].includes(error.code);
async function club(record,actor=2,venue=20,kind='photo') {
  return (await db.query("select review_club_dancer_media($1,$2,$3,$4,$5,'Meets guidelines') value",
    [id(actor),id(venue),kind,record.id,record.updated_at])).rows[0].value;
}

test('private before NFC; club signoff routes to staff and cannot publish',async()=>{
  const r=await upload(100);
  assert.equal((await queue()).count,0);await assert.rejects(club(r),forbidden);
  await tap();assert.equal((await queue()).count,1);assert.equal((await queue(3,21)).count,0);
  await assert.rejects(publish(r,6),changed);
  const reviewed=await club(r,4);
  assert.equal(reviewed.decision,'review');assert.equal(reviewed.status,'pending_review');
  assert.equal(reviewed.club_reviewed_by,id(4));assert.equal((await queue()).count,0);
  assert.equal((await db.query('select count(*) n from dancer_photos')).rows[0].n,0);
  await assert.rejects(publish(reviewed,2),forbidden);
  const final=await publish(reviewed,6);
  assert.equal(final.record.reviewed_by,id(6));assert.equal(final.record.club_reviewed_by,id(4));
  assert.equal(final.record.decision,'approved');
  assert.equal((await publish(reviewed,6)).already_published,true);
});

test('unauthorized club, ordinary staff, stale decision and unfinished file cannot sign off',async()=>{
  await tap();const r=await upload(100);
  for(const actor of [3,5,6])await assert.rejects(club(r,actor),forbidden);
  await assert.rejects(club({...r,updated_at:'2025-01-01T00:00:00Z'}),changed);
  await db.query("update image_moderation_records set category_flags='{}' where id=$1",[r.id]);
  assert.equal((await queue()).count,0);await assert.rejects(club(r),changed);
  await assert.rejects(publish(r,6),changed);
});

test('source replacement resets club signoff and cannot inherit final approval',async()=>{
  await tap();const r=await club(await upload(100));
  await db.query("update image_moderation_records set temporary_storage_path='private/new' where id=$1",[r.id]);
  const next=(await db.query('select * from image_moderation_records where id=$1',[r.id])).rows[0];
  assert.equal(next.club_reviewed_at,null);assert.equal(next.club_reviewed_by,null);
  await assert.rejects(publish(next,6),changed);
});

test('club rejection remains private and disabled MyDancr staff cannot publish',async()=>{
  await tap();const r=await club(await upload(100));
  await db.query("update app_users set account_state='disabled' where id=$1",[id(6)]);
  await assert.rejects(publish(r,6),forbidden);
  await assert.rejects(db.query("update image_moderation_records set decision='rejected',review_decision='rejected',reviewed_by=$1 where id=$2",[id(2),r.id]),forbidden);
  const pending=await upload(101,'profile_gallery:2');
  await db.query("update image_moderation_records set decision='rejected',status='rejected',review_decision='rejected',reviewed_by=$1 where id=$2",[id(2),pending.id]);
  assert.equal((await db.query('select count(*) n from dancer_photos')).rows[0].n,0);
});

test('videos require completed file checks, club signoff and a distinct final admin decision',async()=>{
  await tap();
  await db.query("insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_details) values($1,$2,$3,'submitted','{\"fileChecksPassed\":true}')",[id(200),id(10),id(1)]);
  let v=(await db.query('select * from mydancr_tv_videos')).rows[0];
  const approve=actor=>db.query("update mydancr_tv_videos set status='approved',reviewed_by=$1,reviewed_at=now() where id=$2",[id(actor),v.id]);
  await assert.rejects(approve(6),changed);
  v=await club(v,2,20,'video');assert.equal(v.status,'submitted');assert.equal(v.published_at,null);
  await assert.rejects(approve(2),forbidden);await approve(6);
  assert.equal((await db.query('select status from mydancr_tv_videos')).rows[0].status,'approved');
});

test('a video caption edit invalidates the club decision',async()=>{
  await tap();
  await db.query("insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_details) values($1,$2,$3,'submitted','{\"fileChecksPassed\":true}')",[id(200),id(10),id(1)]);
  await club((await db.query('select * from mydancr_tv_videos')).rows[0],2,20,'video');
  await db.exec("update mydancr_tv_videos set caption='New caption'");
  assert.equal((await db.query('select club_reviewed_at from mydancr_tv_videos')).rows[0].club_reviewed_at,null);
});

test('new rows cannot start approved and human-review RPC is service-only',async()=>{
  await assert.rejects(upload(100,'profile_main',{decision:'approved',status:'approved'}),forbidden);
  await db.exec('set role authenticated');
  await assert.rejects(db.query("select review_club_dancer_media($1,$2,'photo',$3,now(),'')",[id(2),id(20),id(100)]),forbidden);
});

test('dancer grid groups complete queues, keeps same-name dancers distinct and pages their media separately', async () => {
  await tap();
  await db.query('insert into auth.users values($1)', [id(7)]);
  await db.query("insert into app_users(id,role) values($1,'dancer')", [id(7)]);
  await db.query('insert into dancer_profiles(id,user_id) values($1,$2)', [id(17),id(7)]);
  await db.query("insert into venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$2,'active')", [id(20),id(17)]);
  for (let n=100;n<114;n++) await upload(n, n===113 ? 'profile_main' : 'profile_gallery:1');
  await upload(150,'profile_main',{user_id:id(7)});
  await db.query("insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_details) values($1,$2,$3,'submitted','{\"fileChecksPassed\":true}')",[id(200),id(10),id(1)]);
  const overview=await grid();
  assert.equal(overview.count,16); assert.equal(overview.dancerCount,2); assert.equal(overview.items.length,0);
  const first=overview.dancers.find(d=>d.id===id(10));
  assert.equal(first.count,15); assert.equal(first.photoCount,14); assert.equal(first.videoCount,1);
  assert.equal(first.record.upload_context,'profile_main');
  assert.equal(overview.dancers[0].stageName,overview.dancers[1].stageName);
  assert.equal((await grid(null,0,1)).dancers.length,1);
  assert.notEqual((await grid(null,0,1)).dancers[0].id,(await grid(null,1,1)).dancers[0].id);
  const page=await grid(10), next=await grid(10,12);
  assert.equal(page.items.length,12); assert.equal(next.items.length,3); assert.equal(page.uploadCount,15);
  assert.equal(page.items[0].record.upload_context,'profile_main');
  assert.equal(new Set([...page.items,...next.items].map(i=>i.id)).size,15);
  assert.ok([...page.items,...next.items].every(i=>i.dancerId===id(10)));
  const counts=await grid(null,0,0);
  assert.equal(counts.count,16);assert.equal(counts.dancers.length,0);assert.equal(counts.items.length,0);
});

test('dancer grid excludes decisions, unfinished uploads and other clubs; only authorized service calls can read it',async()=>{
  await tap();const approved=await upload(100), rejected=await upload(101), unfinished=await upload(102);
  await club(approved);
  await db.query("update image_moderation_records set decision='rejected',status='rejected',review_decision='rejected',reviewed_by=$1 where id=$2",[id(2),rejected.id]);
  await db.query("update image_moderation_records set category_flags='{}' where id=$1",[unfinished.id]);
  assert.equal((await grid()).dancers.length,0);
  await upload(103);
  assert.equal((await grid(null,0,12,3,21)).count,0);
  const foreign=await grid(10,0,12,3,21);
  assert.equal(foreign.items.length,0);assert.equal(foreign.dancer,null);
  await assert.rejects(grid(null,0,12,5),forbidden);
  await db.exec('set role authenticated');await assert.rejects(grid(),forbidden);
});

test('rejecting a new main photo removes only its pending card and preserves the approved main photo',async()=>{
  await tap();await publish(await club(await upload(100,'profile_main')),6);
  const before=(await db.query('select * from dancer_photos')).rows;
  const replacement=await upload(101,'profile_main',{photo_publication_mode:'replace',replacement_photo_id:before[0].id});
  assert.equal((await grid(10)).items[0].record.upload_context,'profile_main');
  await db.query("update image_moderation_records set decision='rejected',status='rejected',review_decision='rejected',reviewed_by=$1 where id=$2",[id(2),replacement.id]);
  assert.equal((await grid()).count,0);assert.equal((await grid()).dancers.length,0);
  assert.deepEqual((await db.query('select * from dancer_photos')).rows,before);
});
