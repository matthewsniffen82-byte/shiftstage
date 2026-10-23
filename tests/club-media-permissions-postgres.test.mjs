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
  await db.exec('alter table dancer_profiles add column created_at timestamptz default now(),add column updated_at timestamptz default now();alter table venues add column name text default \'Synthetic club\'');
  await db.exec(read('supabase/migrations/20261023081710_club_specific_media_permissions.sql'));
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
  await db.query('insert into venues(id,owner_user_id) values($1,$2),($3,$4)',[id(20),id(2),id(21),id(3)]);
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
const connect = (venue=20) => db.query("insert into venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$2,'active')",[id(venue),id(10)]);
const queue = async (actor=2,venue=20,status='pending') => (await db.query('select get_club_media_queue($1,$2,$3,0,24,$4) value',[id(actor),id(venue),id(10),status])).rows[0].value;
const allowed = async (venue=20) => (await db.query('select club_public_media($1,$2) value',[id(venue),[id(10)]])).rows[0].value;
async function decide(item,decision='approved',actor=2,venue=20,notes='') {
  return (await db.query('select set_club_media_permission($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
    [id(actor),id(venue),id(10),item.source,item.id,item.contentVersion,item.decisionVersion,decision,notes])).rows[0].value;
}
async function publish(record,actor=2) {
  const path = `${id(1)}/${id(10)}/${record.id}.jpg`;
  await db.query("insert into storage.objects values('dancer-photos',$1) on conflict do nothing",[path]);
  return (await db.query("select publish_approved_dancer_gallery_photo($1,$2,$3,'[]','{}','{}',false,null,$4,'Reviewed') value",[record.id,record.updated_at,path,actor===null?null:id(actor)])).rows[0].value;
}
const forbidden = error => error.code==='42501';

test('two clubs keep independent decisions through platform publication and later reversals',async()=>{
  await connect();await connect(21);const r=await upload(100,'profile_main');
  const a=(await queue()).items[0],b=(await queue(3,21)).items[0];
  await decide(b,'rejected',3,21,'Club dress code');
  assert.equal((await db.query('select decision from image_moderation_records')).rows[0].decision,'review');
  await decide(a);
  assert.equal((await queue()).count,0);assert.equal((await queue(3,21)).count,0);
  assert.deepEqual(await allowed(),[]);
  const pending=(await db.query('select * from image_moderation_records where id=$1',[r.id])).rows[0];
  const result=await publish(pending,6);
  assert.equal((await allowed())[0].photoId,result.record.image_id);
  assert.deepEqual(await allowed(21),[]);
  const reviewedB=(await queue(3,21,'all')).items[0];
  assert.equal(reviewedB.clubStatus,'rejected');await decide(reviewedB,'approved',3,21);
  assert.equal((await allowed(21)).length,1);
  await decide((await queue(2,20,'all')).items[0],'rejected');
  assert.deepEqual(await allowed(),[]);assert.equal((await allowed(21)).length,1);
  assert.equal((await db.query('select review_status from dancer_photos')).rows[0].review_status,'approved');
  const statuses=(await db.query('select dancer_club_media_statuses($1) value',[id(1)])).rows[0].value;
  assert.equal(statuses.find(s=>s.venueId===id(20)).status,'rejected');
  assert.equal(statuses.find(s=>s.venueId===id(21)).status,'approved');
});

test('concurrent decisions and source replacement require a fresh review; other clubs never cause stale decisions',async()=>{
  await connect();await connect(21);await upload(100);
  const a=(await queue()).items[0],b=(await queue(3,21)).items[0];
  await decide(a);await decide(b,'approved',3,21);
  await assert.rejects(decide(a,'rejected'),e=>e.code==='40001');
  const old=(await queue(2,20,'all')).items[0];
  await db.query("update image_moderation_records set temporary_storage_path='private/replacement' where id=$1",[old.id]);
  await assert.rejects(decide(old),e=>e.code==='40001');
  assert.equal((await queue()).count,1);assert.equal((await queue(3,21)).count,1);
  await decide((await queue()).items[0]);
  assert.equal((await queue()).count,0);assert.equal((await queue(3,21)).count,1);
});

test('new affiliations need their own approval and removed connections cannot make decisions',async()=>{
  await connect();await upload(100);await decide((await queue()).items[0]);
  assert.equal((await queue(3,21)).items.length,0);
  const a=(await queue(2,20,'all')).items[0];
  await assert.rejects(decide(a,'approved',3,21),forbidden);
  await assert.rejects(decide(a,'approved',5),forbidden);
  await connect(21);assert.equal((await queue(3,21)).count,1);
  await db.query("update venue_dancer_affiliations set status='revoked',revoked_at=now() where venue_id=$1",[id(20)]);
  await assert.rejects(decide(a,'rejected'),forbidden);
});

test('videos retain each club decision after final approval and invalidate it on caption changes',async()=>{
  await connect();await connect(21);
  await db.query(`insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_details)
    values($1,$2,$3,'submitted','{"fileChecksPassed":true}')`,[id(200),id(10),id(1)]);
  await decide((await queue()).items[0]);await decide((await queue(3,21)).items[0],'rejected',3,21);
  await db.query("update mydancr_tv_videos set status='approved',reviewed_by=$1,reviewed_at=now()",[id(6)]);
  assert.equal((await allowed())[0].videoId,id(200));assert.deepEqual(await allowed(21),[]);
  await db.exec("update mydancr_tv_videos set caption='Changed caption'");
  assert.deepEqual(await allowed(),[]);assert.equal((await queue()).items[0].clubStatus,'pending');
});

test('legacy published photos can be reviewed, but a changed path does not inherit permission',async()=>{
  await connect();
  await db.query("insert into dancer_photos(id,dancer_id,storage_path,review_status,is_primary) values($1,$2,'legacy.jpg','approved',true)",[id(300),id(10)]);
  const item=(await queue()).items[0];assert.equal(item.source,'photo');await decide(item);
  assert.equal((await allowed())[0].photoId,id(300));
  await db.exec("update dancer_photos set storage_path='replacement.jpg'");
  assert.deepEqual(await allowed(),[]);assert.equal((await queue()).count,1);
});

test('browser roles cannot read private queues, decisions, or use service approval functions',async()=>{
  await connect();await upload(100);const item=(await queue()).items[0];
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(queue(),forbidden);await assert.rejects(allowed(),forbidden);
    await assert.rejects(decide(item),forbidden);
    await assert.rejects(db.query('select * from club_media_permissions'),forbidden);
  }
});

test('backfill preserves an existing club presentation without granting future clubs permission',async()=>{
  await connect();
  await db.query("insert into dancer_photos(id,dancer_id,storage_path,review_status,is_primary) values($1,$2,'existing.jpg','approved',true)",[id(300),id(10)]);
  const sql=read('supabase/migrations/20261023081710_club_specific_media_permissions.sql');
  await db.exec(sql.slice(sql.indexOf('insert into public.club_media_permissions'),sql.indexOf('-- Preserve a recorded')));
  assert.equal((await allowed()).length,1);assert.deepEqual(await allowed(21),[]);
  await connect(21);assert.equal((await queue(3,21)).count,1);
  assert.equal((await db.query('select provenance from club_media_permissions')).rows[0].provenance,'existing_display');
});
