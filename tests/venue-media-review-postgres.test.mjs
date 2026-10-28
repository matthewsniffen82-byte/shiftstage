import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { dancerSubmissionMedia } from '../src/lib/dancr/dancer-submission-media.ts';

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
  await db.exec(read('supabase/migrations/20261022183959_allow_automated_video_rejection.sql'));
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
  await db.query(`update image_moderation_records set category_flags='{"ai_recommended_approval":true}' where id=$1`, [record.id]);
  return record;
}
const tap = () => db.query("insert into dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id,status,expires_at) values($1,$2,$3,'pending',now()+interval '7 days')",[id(1),id(20),id(30)]);
const authorize = (actor=2, venue=20) => db.query('select assert_dancer_media_reviewer($1,$2,$3)',[id(actor),id(1),id(venue)]);
const queue = async (actor=2,venue=20,offset=0,limit=12) => (await db.query('select get_venue_dancer_media_review($1,$2,$3,$4) value',[id(actor),id(venue),offset,limit])).rows[0].value;
async function publish(record,actor=2) {
  const path = `${id(1)}/${id(10)}/${record.id}.jpg`;
  await db.query("insert into storage.objects values('dancer-photos',$1) on conflict do nothing",[path]);
  return (await db.query("select publish_approved_dancer_gallery_photo($1,$2,$3,'[]','{}','{}',false,null,$4,'Reviewed') value",[record.id,record.updated_at,path,actor===null?null:id(actor)])).rows[0].value;
}
const forbidden = error => error.code==='42501';

test('no club sees uploads until NFC; tap routes photos and videos only to the tapped club', async () => {
  await upload(100); await db.query("insert into mydancr_tv_videos(id,dancer_id,submitted_by,status) values($1,$2,$3,'moderating')",[id(200),id(10),id(1)]);
  assert.equal((await queue()).count,0); await assert.rejects(authorize(),forbidden);
  await tap(); assert.equal((await queue()).count,1); assert.equal((await queue(3,21)).count,0);
  await db.exec("update mydancr_tv_videos set status='submitted',moderation_decision='approved'");
  assert.equal((await queue()).count,2);
  await authorize(4); await assert.rejects(authorize(5),forbidden); await assert.rejects(authorize(3,21),forbidden);
  await assert.rejects(queue(2,21),forbidden);
});

test('expired or revoked taps, disabled tags, revoked managers and disabled owners cannot review', async () => {
  await tap(); await authorize();
  for (const [change,restore] of [
    ["update dancer_nfc_enrollments set expires_at=now()-interval '1 day'","update dancer_nfc_enrollments set expires_at=now()+interval '7 days'"],
    ["update dancer_nfc_enrollments set status='revoked'","update dancer_nfc_enrollments set status='pending'"],
    ["update nfc_tags set status='disabled'","update nfc_tags set status='active'"],
  ]) { await db.exec(change); await assert.rejects(authorize(),forbidden); await db.exec(restore); }
  await db.query("update venue_team_members set status='revoked' where user_id=$1",[id(4)]); await assert.rejects(authorize(4),forbidden);
  await db.query("update app_users set account_state='disabled' where id=$1",[id(2)]); await assert.rejects(authorize(),forbidden);
});

test('active affiliation routes later uploads without another pending tap, and removal stops access', async () => {
  await db.query("insert into venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$2,'active')",[id(20),id(10)]);
  await upload(100); assert.equal((await queue()).count,1); await authorize();
  await db.exec("update venue_dancer_affiliations set status='revoked',revoked_at=now()"); await assert.rejects(authorize(),forbidden);
});

test('club human approval publishes exactly once; AI, staff and other clubs cannot publish', async () => {
  await tap(); const record=await upload(100);
  for(const actor of [null,3,5]) await assert.rejects(publish(record,actor),forbidden);
  assert.equal((await db.query('select count(*) n from dancer_photos')).rows[0].n,0);
  const result=await publish(record,4); assert.equal(result.record.reviewed_by,id(4)); assert.equal(result.record.decision,'approved');
  assert.equal((await publish(record,4)).already_published,true); assert.equal((await queue()).count,0);
});

test('running AI and stale review versions cannot publish; failed decisions roll back gallery writes', async () => {
  await tap(); const record=await upload(100,'profile_main',{status:'moderating'});
  await assert.rejects(publish(record),error=>error.code==='40001');
  assert.equal((await db.query('select count(*) n from dancer_photos')).rows[0].n,0);
  await db.exec("update image_moderation_records set status='pending_review',updated_at=now()");
  await assert.rejects(publish(record),error=>error.code==='40001');
});

test('pending photos unlock submission, but first activation still needs three approved photos', async () => {
  const uploads=[await upload(100,'profile_main'),await upload(101),await upload(102)];
  const state=(await db.query('select dancer_submission_media($1) value',[id(10)])).rows[0].value;
  assert.deepEqual(state,{count:3,hasMain:true}); assert.deepEqual(dancerSubmissionMedia({pending_photo_reviews:uploads}),{...state,videoCount:0});
  await db.query("update dancer_profiles set status='pending_review' where id=$1",[id(10)]);
  await assert.rejects(db.query("update dancer_profiles set status='approved' where id=$1",[id(10)]),/3 profile photos/);
  await tap(); for(const record of uploads) await publish(record);
  await db.query("update dancer_profiles set status='approved' where id=$1",[id(10)]);
});

test('duplicate main uploads and replacements cannot inflate the onboarding photo count', async () => {
  const a=await upload(100,'profile_main'),b=await upload(101,'profile_main');
  assert.equal((await db.query('select dancer_submission_media($1) value',[id(10)])).rows[0].value.count,1);
  assert.equal(dancerSubmissionMedia({pending_photo_reviews:[a,b]}).count,1);
  await assert.rejects(db.query("update dancer_profiles set status='pending_review' where id=$1",[id(10)]),/at least 3/);
});

test('video publication and rejection recheck current club authorization in the transaction', async () => {
  await tap(); await db.query("insert into mydancr_tv_videos(id,dancer_id,submitted_by,status) values($1,$2,$3,'moderating')",[id(200),id(10),id(1)]);
  await assert.rejects(db.query("update mydancr_tv_videos set status='approved',reviewed_by=$1",[id(2)]),error=>error.code==='40001');
  await db.exec("update mydancr_tv_videos set status='submitted'");
  await assert.rejects(db.query("update mydancr_tv_videos set status='approved',reviewed_by=$1",[id(3)]),forbidden);
  await db.exec("update dancer_nfc_enrollments set status='revoked'");
  await assert.rejects(db.query("update mydancr_tv_videos set status='rejected',reviewed_by=$1",[id(2)]),forbidden);
  await db.exec("update dancer_nfc_enrollments set status='pending'");
  await db.query("update mydancr_tv_videos set status='approved',reviewed_by=$1",[id(2)]);
});

test('queue totals include every upload, pagination remains scoped, and signed-out roles cannot call privileged helpers', async () => {
  await tap(); for(let n=100;n<127;n++) await upload(n);
  assert.equal((await queue()).count,27);assert.equal((await queue()).items.length,12);assert.equal((await queue(2,20,24)).items.length,3);
  assert.equal((await queue(2,20,0,0)).items.length,0);
  for(const signature of ['venue_media_dancers(uuid)','assert_dancer_media_reviewer(uuid,uuid,uuid)','get_venue_dancer_media_review(uuid,uuid,integer,integer)','dancer_submission_media(uuid)']) {
    for(const role of ['anon','authenticated']) assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);
  }
});

test('a claimed automatic rejection settles privately without a club reviewer', async () => {
  await tap();
  await db.query(`insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_details)
    values($1,$2,$3,'moderating','{"workerId":"fixture-worker"}')`, [id(200),id(10),id(1)]);
  await db.exec(`update mydancr_tv_videos set status='rejected',moderation_decision='rejected',
    moderation_completed_at=now(),moderation_reason_codes=array['visible_branding_or_logo']`);
  const row=(await db.query('select * from mydancr_tv_videos')).rows[0];
  assert.equal(row.status,'rejected'); assert.equal(row.reviewed_by,null); assert.equal(row.published_at,null);
  assert.equal((await queue()).count,0);
});

test('automatic rejection cannot bypass reviewer checks for approval or incomplete decisions', async () => {
  await db.query(`insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_details)
    values($1,$2,$3,'moderating','{"workerId":"fixture-worker"}')`, [id(200),id(10),id(1)]);
  await assert.rejects(db.exec("update mydancr_tv_videos set status='rejected'"),forbidden);
  await assert.rejects(db.exec("update mydancr_tv_videos set status='approved'"),error=>error.code==='40001');
  await db.exec("update mydancr_tv_videos set status='submitted',moderation_decision='approved'");
  await assert.rejects(db.exec("update mydancr_tv_videos set status='approved'"),forbidden);
});

test('club queue and count exclude running, failed, rejected, and unchecked media', async () => {
  await tap();
  await upload(100); await upload(101,'profile_gallery',{status:'moderating'}); await upload(102);
  await db.query("update image_moderation_records set category_flags='{}' where id=$1",[id(102)]);
  for (const [n,status,decision,pending] of [[200,'moderating',null,false],[201,'submitted','review',false],
    [202,'rejected','rejected',false],[203,'submitted','approved',true],[204,'submitted','approved',false]]) {
    await db.query('insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_decision,upload_validation_pending) values($1,$2,$3,$4,$5,$6)',[id(n),id(10),id(1),status,decision,pending]);
  }
  assert.deepEqual((await queue()).items.map(item=>item.id),[id(100),id(204)]);
  assert.equal((await queue(2,20,0,0)).count,2);
});
