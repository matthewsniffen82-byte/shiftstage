import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261029060551_explicit_media_submission_batches.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(read('tests/gallery-publication-postgres.test.mjs').match(/const schema = `([\s\S]*?)`;/)[1]);
 await db.exec(read('supabase/migrations/20260909203842_add_atomic_gallery_publication.sql'));
 await db.exec(`create schema private;grant usage on schema private to service_role;
 alter table app_users add column admin_workspace_role text default 'owner';
 alter table dancer_profiles add column stage_name text default 'Test dancer',add column status text default 'pending_review',
 add column verification_status text default 'pending',add column venue_approved_at timestamptz,add column approved_at timestamptz,
 add column disabled_at timestamptz,add column created_at timestamptz default now(),add column updated_at timestamptz default now();
 alter table image_moderation_records add column avatar_expected_path text,add column avatar_expected_updated_at timestamptz;
 create table venues(id uuid primary key,name text default 'Test club',owner_user_id uuid,is_active boolean default true);
 create table venue_team_members(id uuid primary key,venue_id uuid,user_id uuid,role text,status text);
 create table venue_dancer_affiliations(id uuid primary key,venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz);
 create table nfc_tags(id uuid primary key,status text);
 create table dancer_nfc_enrollments(id uuid default gen_random_uuid(),dancer_user_id uuid,venue_id uuid,nfc_tag_id uuid,status text,
 expires_at timestamptz,tapped_at timestamptz default now());
 create table club_dancer_approvals(venue_id uuid,dancer_id uuid,status text);
 create table mydancr_tv_videos(id uuid primary key,dancer_id uuid,submitted_by uuid,status text,reviewed_by uuid,review_notes text,
 upload_validation_pending boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(),
 moderation_decision text,moderation_completed_at timestamptz,moderation_reason_codes text[] default '{}',
 moderation_details jsonb default '{}',reviewed_at timestamptz,published_at timestamptz,expires_at timestamptz,venue_featured boolean default false,
 storage_path text default 'private/video.mp4',storage_mime text default 'video/mp4',caption text default 'Test video',width integer default 720,height integer default 1280,
 duration_seconds numeric default 10,moderation_attempt_count integer default 0,moderation_started_at timestamptz,distribution_scope text default 'profile_and_feed');
 grant all on all tables in schema public to service_role;`);
 for(const file of ['20261020224618_venue_dancer_media_review.sql','20261023025136_human_media_approval.sql','20261023054159_venue_media_dancer_grid.sql','20261023081710_club_specific_media_permissions.sql']) await db.exec(read('supabase/migrations/'+file));
 await db.exec(`create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb);
 create table venue_email_events(event_key text primary key,venue_id uuid);
 create table venue_email_deliveries(id uuid primary key,status text,created_at timestamptz);
 create table admin_review_email_events(event_key text primary key,kind text,source_id uuid,title text,body text);
 create table admin_review_email_deliveries(id uuid default gen_random_uuid(),event_key text,recipient_id uuid,notification_id uuid,status text default 'pending',outcome text,finished_at timestamptz,attempts integer default 0,unique(event_key,recipient_id));
 create table dancer_media_email_deliveries(id uuid primary key default gen_random_uuid(),recipient_id uuid,title text,body text,payload jsonb,status text default 'pending',
 attempts integer default 0,created_at timestamptz default now(),next_attempt_at timestamptz default now(),lease_id uuid,lease_until timestamptz,destination text,outcome text,finished_at timestamptz,summary_id uuid);
 create function private.emit_venue_email_event(uuid,text,text,text,text,text,boolean default true) returns void language sql as $$insert into public.venue_email_events values($2,$1) on conflict do nothing$$;
 create function private.dancer_media_review_pending(uuid) returns boolean language sql as $$select false$$;
 create function private.dancer_media_email_account(uuid) returns text language sql as $$select 'fixture@example.invalid'::text$$;
 grant all on all tables in schema public to service_role;`);
 await db.exec(migration).catch(e=>{throw new Error(`${e.message} at ${e.position}: ${migration.slice(Number(e.position)-120,Number(e.position)+150)} ${e.where||''}`);});
 await db.exec(`create table shifts(id uuid default gen_random_uuid(),dancer_id uuid,venue_id uuid,status text,
 checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
 grant all on shifts to service_role;`);
 const editor=read('supabase/migrations/20261029071856_club_scoped_dancer_editor.sql');
 await db.exec(editor).catch(e=>{throw new Error(`${e.message} at ${e.position}: ${editor.slice(Number(e.position)-120,Number(e.position)+150)} ${e.where||''}`);});
 await db.exec(`alter table nfc_tags add column venue_id uuid;
 create table dancer_channel_tap_receipts(user_id uuid,session_id uuid,tag_id uuid,receipt jsonb,primary key(user_id,session_id));
 grant all on dancer_channel_tap_receipts to service_role;`);
 await db.exec(read('supabase/migrations/20261029090504_submit_off_shift_media_on_check_in.sql'));
 await db.exec(read('supabase/migrations/20261029215306_multi_club_checkin_media_eligibility.sql'));
 await db.exec(read('supabase/migrations/20261031004742_media_batch_review_rpc_transaction.sql'));
 await db.exec(read('supabase/migrations/20261031004744_nfc_business_conflict_sqlstates.sql'));
 // Isolate the batch boundary from the separately tested NFC/identity system.
 await db.exec(`create or replace function public.complete_saved_dancer_check_in(p_enrollment_id uuid) returns jsonb language plpgsql as $$begin
 update public.dancer_profiles set status='approved',verification_status='approved',venue_approved_at=now(),approved_at=now()
 where user_id=(select dancer_user_id from public.dancer_nfc_enrollments where id=p_enrollment_id);
 return jsonb_build_object('enrollmentStatus','completed','shiftCheckedIn',true);end$$;`);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate dancer_channel_tap_receipts,shifts,dancer_media_batches,dancer_media_submissions,dancer_media_email_deliveries,admin_review_email_deliveries,admin_review_email_events,venue_email_events,notifications,club_media_permissions,club_dancer_approvals,venue_dancer_affiliations,dancer_nfc_enrollments,nfc_tags,venues,dancer_photos,image_moderation_records,mydancr_tv_videos,dancer_profiles,app_users,auth.users,storage.objects cascade');
 for(const [n,role] of [[1,'dancer'],[2,'venue'],[3,'admin'],[4,'venue'],[5,'dancer']]) {
  await db.query('insert into auth.users values($1)',[id(n)]);await db.query('insert into app_users(id,role) values($1,$2)',[id(n),role]);
 }
 await db.query('insert into dancer_profiles(id,user_id) values($1,$2),($3,$4)',[id(11),id(1),id(15),id(5)]);
 await db.query('insert into venues(id,owner_user_id) values($1,$2),($3,$4)',[id(21),id(2),id(24),id(4)]);
 await db.query("insert into venue_dancer_affiliations values($1,$2,$3,'active',null)",[id(31),id(21),id(11)]);
 await db.query("insert into dancer_nfc_enrollments(dancer_user_id,venue_id,status,expires_at) values($1,$2,'pending',now()+interval '1 day')",[id(1),id(21)]);
 await db.exec('set role service_role');
});
async function query(sql,args=[]){return (await db.query(sql,args)).rows;}
async function rpc(name,args=[]){return (await query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}
async function photo(n,main=false){const path=`${id(1)}/${id(11)}/${n}.jpg`;
 await db.query("insert into storage.objects values('dancer-photos',$1)",[path]);
 await db.query(`insert into image_moderation_records(id,user_id,temporary_storage_path,final_storage_path,upload_context,decision,status,category_flags)
 values($1,$2,$3,$3,$4,'review','pending_review','{"file_checks_passed":true,"publication_prepared":true}')`,[id(n),id(1),path,main?'profile_main':'profile_gallery:'+n]);}
async function video(n){await db.query(`insert into mydancr_tv_videos(id,dancer_id,submitted_by,status,moderation_details)
 values($1,$2,$3,'submitted','{"fileChecksPassed":true,"preparedPublication":{"storagePath":"private/video.mp4"}}')`,[id(n),id(11),id(1)]);}
async function submit(){await rpc('submit_dancer_media_batch',[id(1)]);return (await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches[0];}
async function detail(b,role='venue',actor=role==='venue'?2:3){return rpc('get_media_batch',[id(actor),role,b.id]);}
async function chooseAll(b,role='venue',reject=[],actor=role==='venue'?2:3){let batch=await detail(b,role,actor);
 for(const item of batch.items){if(item.withdrawn || (role==='admin'&&(item.resolved||item.club?.decision!=='approved')))continue;
 const saved=await rpc('save_media_batch_decision',[id(actor),role,b.id,batch.revision,item.key,reject.includes(item.id)?'rejected':'approved','Test review']);batch.revision=saved.revision;}
 return batch;}
async function club(b){const saved=await chooseAll(b);await rpc('submit_club_media_batch',[id(2),b.id,saved.revision]);return detail(b,'admin');}
async function finish(b,reject=[]){const saved=await chooseAll(b,'admin',reject);return rpc('submit_admin_media_batch',[id(3),b.id,saved.revision]);}
async function baseline(){await photo(40,true);await photo(41);await photo(42);await video(43);return submit();}

test('review detail works in the transaction mode PostgREST selects for the RPC',async()=>{
 const b=await baseline();
 const [{provolatile}]=await query("select provolatile from pg_proc where oid='public.get_media_batch(uuid,text,uuid)'::regprocedure");
 // POST RPCs marked stable/immutable are read-only; volatile RPCs are read-write.
 await db.exec(provolatile==='v'?'begin read write':'begin read only');
 try { assert.equal((await detail(b)).items.length,4); }
 finally { await db.exec('rollback'); }
 await assert.rejects(detail(b,'venue',4),/FORBIDDEN|not|permission/i);
});
test('uploads stay private drafts with no club queue or email until dancer Submit',async()=>{
 await photo(40,true);await video(43);
 assert.equal((await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches.length,0);
 assert.equal((await query('select count(*) n from venue_email_events'))[0].n,0);
 assert.equal((await rpc('get_media_batches',[id(1),'dancer',null,null])).draftCount,2);
 const b=await submit();assert.equal(b.item_count,2);
 await rpc('submit_dancer_media_batch',[id(1)]);
 assert.equal((await query('select count(*) n from dancer_media_batches'))[0].n,1);
 assert.equal((await query('select count(*) n from venue_email_events'))[0].n,1);
});
test('club drafts survive reload; only Submit forwards the complete batch and one email',async()=>{
 const b=await baseline();const saved=await chooseAll(b);
 assert.equal((await detail(b)).club_decisions['video:'+id(43)].decision,'approved');
 assert.equal((await query('select count(*) n from club_media_permissions'))[0].n,0);
 assert.equal((await query('select count(*) n from admin_review_email_events'))[0].n,0);
 await rpc('submit_club_media_batch',[id(2),b.id,saved.revision]);await rpc('submit_club_media_batch',[id(2),b.id,saved.revision]);
 assert.equal((await query('select count(*) n from club_media_permissions'))[0].n,4);
 assert.equal((await query('select count(*) n from admin_review_email_events'))[0].n,1);
});
test('admin draft decisions do not publish; Submit approves eligible account and sends exactly one result',async()=>{
 const b=await baseline();await club(b);const saved=await chooseAll(b,'admin');
 assert.equal((await query('select count(*) n from dancer_photos'))[0].n,0);
 assert.equal((await query('select count(*) n from dancer_media_email_deliveries'))[0].n,0);
 const result=await rpc('submit_admin_media_batch',[id(3),b.id,saved.revision]);
 assert.equal(result.state,'completed');assert.equal(result.result.outcome,'approved');
 await rpc('submit_admin_media_batch',[id(3),b.id,saved.revision]);
 assert.equal((await query('select count(*) n from dancer_media_email_deliveries'))[0].n,1);
 assert.equal((await query('select count(*) n from dancer_photos'))[0].n,3);
 assert.equal((await rpc('get_dancer_media_review_outcome',[id(1)])).body,result.result.body);
});
test('rejecting an extra still approves; missing required video produces one remedy result',async()=>{
 await photo(44);const b=await baseline();await club(b);const result=await finish(b,[id(44)]);
 assert.equal(result.result.outcome,'approved');assert.equal(result.result.photoCount,1);
 assert.match(result.result.body,/replacements are optional/);
});
test('insufficient media never activates and tells dancer exactly what to replace',async()=>{
 const b=await baseline();await club(b);const result=await finish(b,[id(43)]);
 assert.equal(result.result.outcome,'needs_media');assert.match(result.result.body,/1 approved video/);
 assert.equal((await query('select status from dancer_profiles where id=$1',[id(11)]))[0].status,'pending_review');
 assert.equal((await query('select count(*) n from dancer_media_email_deliveries'))[0].n,1);
});
test('a new draft is excluded from the submitted batch and cannot delay its final email',async()=>{
 const b=await baseline();await photo(44);await club(b);await finish(b);
 assert.equal((await query('select status from image_moderation_records where id=$1',[id(44)]))[0].status,'pending_review');
 const jobs=await query('select * from claim_dancer_media_emails()');assert.equal(jobs.length,1);
 const email=await rpc('dancer_media_email_target',[jobs[0].id,jobs[0].lease_id]);assert.equal(email.payload.outcome,'approved');
 assert.equal((await rpc('get_media_batches',[id(1),'dancer',null,null])).draftCount,1);
});
test('unauthorized and stale reviewers cannot change or submit another batch',async()=>{
 const b=await baseline();await assert.rejects(detail(b,'venue',4),/FORBIDDEN|not|permission/i);
 await assert.rejects(rpc('submit_dancer_media_batch',[id(2)]),/FORBIDDEN/);
 const saved=await chooseAll(b);
 await assert.rejects(rpc('save_media_batch_decision',[id(2),'venue',b.id,b.revision,'upload:'+id(40),'rejected','']),/changed/);
 await assert.rejects(rpc('submit_club_media_batch',[id(2),b.id,b.revision]),/changed/);
 await rpc('submit_club_media_batch',[id(2),b.id,saved.revision]);
});
test('incomplete batches and old per-item publication cannot bypass Submit',async()=>{
 const b=await baseline();await assert.rejects(rpc('submit_club_media_batch',[id(2),b.id,b.revision]),/every item/);
 await club(b);const admin=await detail(b,'admin');
 await assert.rejects(rpc('submit_admin_media_batch',[id(3),b.id,admin.revision]),/every item/);
 await assert.rejects(db.query("update image_moderation_records set status='rejected',decision='rejected',reviewed_by=$1 where id=$2",[id(3),id(40)]),/Submit review/);
});
test('another club has independent decisions and receives no unsubmitted drafts',async()=>{
 const b=await baseline();await photo(44);
 await db.query("insert into venue_dancer_affiliations values($1,$2,$3,'active',null)",[id(34),id(24),id(11)]);
 const other=(await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches[0];assert.equal(other.item_count,4);
 await chooseAll(other,'venue',[id(40)],4);await club(b);await finish(b);
 const state=await detail(other,'venue',4);assert.equal(state.state,'club');assert.equal(state.club_decisions['upload:'+id(40)].decision,'rejected');
});
test('removed items do not deadlock a batch; a failure rolls back all decisions and email',async()=>{
 const b=await baseline();await club(b);const saved=await chooseAll(b,'admin');
 await db.query("update mydancr_tv_videos set duration_seconds=31 where id=$1",[id(43)]);
 // Content changed: the old item is withdrawn, never approve the replacement.
 const result=await rpc('submit_admin_media_batch',[id(3),b.id,saved.revision]);assert.equal(result.result.outcome,'needs_media');
 assert.equal((await query('select status from mydancr_tv_videos'))[0].status,'submitted');
});
test('publication failure rolls back earlier photos, receipt and batch completion',async()=>{
 const b=await baseline();await club(b);const saved=await chooseAll(b,'admin');
 await db.query("update image_moderation_records set category_flags=category_flags-'publication_prepared' where id=$1",[id(42)]);
 await assert.rejects(rpc('submit_admin_media_batch',[id(3),b.id,saved.revision]),/preparing/);
 assert.equal((await query('select count(*) n from dancer_photos'))[0].n,0);
 assert.equal((await detail(b,'admin')).state,'admin');
 assert.equal((await query('select count(*) n from dancer_media_email_deliveries'))[0].n,0);
 await db.query("update image_moderation_records set category_flags=category_flags||'{\"publication_prepared\":true}' where id=$1",[id(42)]);
 assert.equal((await rpc('submit_admin_media_batch',[id(3),b.id,saved.revision])).result.outcome,'approved');
});
test('browser database roles cannot inspect batches or call reviewer commands',async()=>{
 await baseline();
 for(const role of ['anon','authenticated']) {
  await db.exec('reset role;set role '+role);
  await assert.rejects(query('select * from public.dancer_media_batches'),/permission denied/);
  await assert.rejects(rpc('get_media_batches',[id(3),'admin',null,null]),/permission denied/);
 }
 await db.exec('reset role;set role service_role');
});
test('processing files cannot be silently left out of a submission',async()=>{
 await photo(40,true);await db.query("update image_moderation_records set status='moderating' where id=$1",[id(40)]);
 await assert.rejects(rpc('submit_dancer_media_batch',[id(1)]),/processing/);
 assert.equal((await query('select count(*) n from dancer_media_submissions'))[0].n,0);
});
test('onboarding submission waits for the first club and excludes drafts uploaded afterward',async()=>{
 await db.exec('delete from venue_dancer_affiliations;delete from dancer_nfc_enrollments');
 await photo(40,true);await rpc('submit_dancer_media_batch',[id(1)]);await photo(41);
 assert.equal((await rpc('get_media_batches',[id(1),'dancer',null,null])).waitingForClub,true);
 assert.equal((await query('select count(*) n from venue_email_events'))[0].n,0);
 await db.query("insert into venue_dancer_affiliations values($1,$2,$3,'active',null)",[id(31),id(21),id(11)]);
 const batches=await rpc('get_media_batches',[id(2),'venue',id(21),null]);assert.equal(batches.batches[0].item_count,1);
 assert.equal((await rpc('get_media_batches',[id(1),'dancer',null,null])).waitingForClub,false);
});

async function approvedAtBoth() {
 const b=await baseline();await club(b);await finish(b);
 await db.query("insert into venue_dancer_affiliations values($1,$2,$3,'active',null)",[id(34),id(24),id(11)]);
 const other=(await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches[0];
 const saved=await chooseAll(other,'venue',[],4);await rpc('submit_club_media_batch',[id(4),other.id,saved.revision]);await finish(other);
}
const visible=venue=>rpc('club_public_media',[id(venue),[id(11)]]);

test('already approved media completes at the club with no admin queue or duplicate result email',async()=>{
 const b=await baseline();await club(b);await finish(b);
 const adminCount=(await query('select count(*) n from admin_review_email_events'))[0].n;
 await db.query("insert into venue_dancer_affiliations values($1,$2,$3,'active',null)",[id(34),id(24),id(11)]);
 const other=(await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches[0];
 const choices=await chooseAll(other,'venue',[],4);
 const before=(await query('select count(*) n from dancer_media_email_deliveries'))[0].n;
 const result=await rpc('submit_club_media_batch',[id(4),other.id,choices.revision]);
 assert.equal(result.state,'completed');assert.equal(result.result.clubEligible,true);
 const receipt=(await query('select club_submitted_by,club_submitted_at,admin_submitted_by from dancer_media_batches where id=$1',[other.id]))[0];
 assert.equal(receipt.club_submitted_by,id(4));assert.ok(receipt.club_submitted_at);assert.equal(receipt.admin_submitted_by,null);
 assert.equal(result.result.approvedPhotos,3);assert.equal(result.result.approvedVideos,1);
 assert.equal((await query('select count(*) n from admin_review_email_events'))[0].n,adminCount);
 assert.equal((await rpc('get_media_batches',[id(3),'admin',id(24),null])).batches.length,0);
 await rpc('submit_club_media_batch',[id(4),other.id,choices.revision]);
 assert.equal((await query('select count(*) n from dancer_media_email_deliveries'))[0].n,before+1);
});
test('mixed batches require admin decisions only for new club-approved media',async()=>{
 const b=await baseline();await club(b);await finish(b);await photo(70);
 await db.query('update image_moderation_records set editor_venue_id=$1 where id=$2',[id(24),id(70)]);
 await db.query("insert into venue_dancer_affiliations values($1,$2,$3,'active',null)",[id(34),id(24),id(11)]);
 await checkIn(24);await rpc('submit_dancer_club_media_batch',[id(1),id(24)]);
 const batches=(await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches;
 const batch=batches.find(x=>x.item_count>1);assert.ok(batch);
 const choices=await chooseAll(batch,'venue',[],4);
 assert.equal((await rpc('submit_club_media_batch',[id(4),batch.id,choices.revision])).state,'admin');
 const admin=await detail(batch,'admin');assert.deepEqual(admin.items.filter(x=>!x.resolved&&x.club?.decision==='approved').map(x=>x.id),[id(70)]);
});
for(const rejected of [40,41,43])test(`club rejection of required item ${rejected} keeps A eligible and B private`,async()=>{
 const b=await baseline();await club(b);await finish(b);const original=await visible(21);
 await db.query("insert into venue_dancer_affiliations values($1,$2,$3,'active',null)",[id(34),id(24),id(11)]);
 const other=(await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches[0];
 const choices=await chooseAll(other,'venue',[id(rejected)],4);
 const result=await rpc('submit_club_media_batch',[id(4),other.id,choices.revision]);
 assert.equal(result.state,'completed');assert.equal(result.result.clubEligible,false);
 assert.deepEqual(await visible(24),[]);assert.deepEqual(await visible(21),original);
 const requirements=await rpc('dancer_club_media_requirements',[id(1)]);
 assert.equal(requirements.find(r=>r.venueId===id(21)).eligible,true);assert.equal(requirements.find(r=>r.venueId===id(24)).eligible,false);
 const statuses=await rpc('dancer_club_media_statuses',[id(1)]);
 assert.equal(statuses.find(r=>r.venueId===id(24)&&r.id===id(rejected)).status,'rejected');
 assert.equal(statuses.find(r=>r.venueId===id(24)&&r.id===id(rejected)).hidden,false);
});
test('expired and feed-only videos cannot satisfy a club minimum',async()=>{
 await approvedAtBoth();
 await db.exec("update mydancr_tv_videos set expires_at=now()-interval '1 day'");assert.deepEqual(await visible(21),[]);
 await db.exec("update mydancr_tv_videos set expires_at=now()+interval '1 day',distribution_scope='feed_only'");assert.deepEqual(await visible(21),[]);
});
test('browser roles cannot read private club inventories or finish review batches',async()=>{
 for(const role of ['anon','authenticated'])for(const signature of ['public.club_approved_media(uuid,uuid[])','public.dancer_club_media_requirements(uuid)',
 'private.club_media_eligibility(uuid,uuid[])','private.club_media_ready(uuid,uuid)','private.finish_resolved_club_media_batch(uuid,jsonb,uuid)']){
  assert.equal((await query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature]))[0].allowed,false);
 }
});
test('off-shift dancers can edit either connected club; verified check-in prevents stale or foreign selection',async()=>{
 await approvedAtBoth();
 for(const club of [21,24])assert.equal((await rpc('dancer_media_editor_context',[id(1),id(club)])).venueId,id(club));
 await assert.rejects(rpc('dancer_media_editor_context',[id(1),id(999)]),/connected clubs/);
 await db.query("insert into shifts(dancer_id,venue_id,status,checked_in_at,location_status,location_verification_expires_at) values($1,$2,'posted',now(),'club_confirmed',now()+interval '1 hour')",[id(11),id(21)]);
 assert.equal((await rpc('dancer_media_editor_context',[id(1),null])).venueId,id(21));
 await assert.rejects(rpc('dancer_media_editor_context',[id(1),id(24)]),/check-in changed/);
 await assert.rejects(rpc('submit_dancer_club_media_batch',[id(1),id(24)]),/check-in changed/);
 await db.exec("update shifts set checked_out_at=now()");
 assert.equal((await rpc('dancer_media_editor_context',[id(1),id(24)])).venueId,id(24));
});
test('club drafts and submission emails are isolated, including processing in a different club',async()=>{
 await approvedAtBoth();await checkIn(21);await photo(70);await photo(71);
 await db.query('update image_moderation_records set editor_venue_id=$1 where id=$2',[id(21),id(70)]);
 await db.query("update image_moderation_records set editor_venue_id=$1,status='moderating' where id=$2",[id(24),id(71)]);
 const before=(await query('select count(*) n from venue_email_events'))[0].n;
 const res=await rpc('submit_dancer_club_media_batch',[id(1),id(21)]);assert.equal(res.submitted,1);
 assert.equal((await query('select count(*) n from venue_email_events'))[0].n,before+1);
 const a=await rpc('get_media_batches',[id(1),'dancer',id(21),null]);const b=await rpc('get_media_batches',[id(1),'dancer',id(24),null]);
 assert.equal(a.batches.filter(b=>b.state==='club').length,1);assert.equal(b.batches.filter(b=>b.state==='club').length,0);
 const rows=await rpc('dancer_club_media_statuses',[id(1)]);
 assert.deepEqual(rows.filter(r=>r.id===id(70)).map(r=>r.venueId),[id(21)]);
 assert.deepEqual(rows.filter(r=>r.id===id(71)).map(r=>r.venueId),[id(24)]);
 await db.exec('delete from shifts');await checkIn(24);await assert.rejects(rpc('submit_dancer_club_media_batch',[id(1),id(24)]),/processing/);
});
test('removal, main photo and pins belong only to the edited club and keep source files',async()=>{
 await approvedAtBoth();const original=await visible(21);const photos=original.filter(r=>r.photoId);
 await rpc('edit_dancer_club_media',[id(1),id(21),'photo',photos[1].photoId,'main',null]);
 await rpc('edit_dancer_club_media',[id(1),id(21),'photo',photos[1].photoId,'pin',true]);
 assert.equal((await visible(21)).find(r=>r.isMain).photoId,photos[1].photoId);
 assert.deepEqual(await visible(24),original);
 await rpc('edit_dancer_club_media',[id(1),id(21),'photo',photos[0].photoId,'remove',null]);
 assert.equal((await visible(21)).some(r=>r.photoId===photos[0].photoId),false);
 assert.deepEqual(await visible(21),[], 'the club is hidden when fewer than three approved photos remain');
 assert.equal((await rpc('club_approved_media',[id(21),[id(11)]])).filter(r=>r.photoId).length,2,'owner can still edit remaining media');
 assert.equal((await visible(24)).some(r=>r.photoId===photos[0].photoId),true);
 assert.equal((await query('select count(*) n from dancer_photos'))[0].n,3);
 assert.equal((await rpc('dancer_club_media_statuses',[id(1)])).find(r=>r.venueId===id(21)&&r.photoId===photos[0].photoId).hidden,true);
});
test('cropping adds a private reviewed replacement and keeps the other club original',async()=>{
 await approvedAtBoth();const original=(await visible(21)).find(r=>r.photoId).photoId;await checkIn(21);await photo(70);
 await db.query('update image_moderation_records set editor_venue_id=$1,editor_is_main=true,editor_replaces_photo_id=$2 where id=$3',[id(21),original,id(70)]);
 await rpc('submit_dancer_club_media_batch',[id(1),id(21)]);
 const batch=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches[0];
 assert.equal((await visible(21)).some(r=>r.photoId===original),true);
 await club(batch);await finish(batch);
 const a=await visible(21),b=await visible(24);assert.equal(a.some(r=>r.photoId===original),false);assert.equal(b.some(r=>r.photoId===original),true);
 const main=a.find(r=>r.isMain);assert.ok(main);assert.equal(b.some(r=>r.photoId===main.photoId),false);
 const statuses=await rpc('dancer_club_media_statuses',[id(1)]);
 assert.equal(statuses.find(r=>r.venueId===id(21)&&r.photoId===original).hidden,true);
 assert.equal(statuses.find(r=>r.venueId===id(21)&&r.id===id(70)).isMain,true);
 assert.equal((await query('select count(*) n from dancer_photos'))[0].n,4);
});
test('removing a submitted club draft prevents later approval from publishing it',async()=>{
 await approvedAtBoth();await checkIn(21);await photo(70);await db.query('update image_moderation_records set editor_venue_id=$1 where id=$2',[id(21),id(70)]);
 await rpc('submit_dancer_club_media_batch',[id(1),id(21)]);const b=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches[0];await club(b);
 await rpc('edit_dancer_club_media',[id(1),id(21),'photo',id(70),'remove',null]);
 assert.equal((await detail(b,'admin')).items[0].withdrawn,true);await finish(b);
 assert.equal((await query('select status from image_moderation_records where id=$1',[id(70)]))[0].status,'pending_review');
});
test('browser roles cannot call service editor RPCs or read club edit rows',async()=>{
 await db.exec('reset role;set role authenticated');
 for(const name of ['dancer_media_editor_context','submit_dancer_club_media_batch'])await assert.rejects(rpc(name,[id(1),id(21)]),/permission denied/);
 await assert.rejects(query('select * from dancer_club_media_edits'),/permission denied/);
});

async function checkIn(venue=21){await db.query("insert into shifts(dancer_id,venue_id,status,checked_in_at,location_status,location_verification_expires_at) values($1,$2,'posted',now(),'club_confirmed',now()+interval '6 hours')",[id(11),id(venue)]);}
async function tapReceipt(venue=21,session=90,alreadyWorking=false,pending=false){
 await db.query("insert into nfc_tags(id,venue_id,status) values($1,$2,'active') on conflict(id) do nothing",[id(800+venue),id(venue)]);
 if(pending)await db.query("insert into dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id,status,expires_at) values($1,$2,$3,'pending',now()+interval '1 day')",[id(1),id(venue),id(800+venue)]);
 await db.query('insert into dancer_channel_tap_receipts values($1,$2,$3,$4) on conflict(user_id,session_id) do nothing',[id(1),id(session),id(800+venue),JSON.stringify({venueId:id(venue),enrollmentStatus:pending?'pending':'completed',shiftCheckedIn:!pending,alreadyWorking})]);
}
async function clubDraft(n,venue=21){await photo(n);await db.query('update image_moderation_records set editor_venue_id=$1 where id=$2',[id(venue),id(n)]);}
test('off-shift drafts wait for a real tap and leave the approved live media unchanged through both review stages',async()=>{
 await approvedAtBoth();const original=await visible(21);const emails=(await query('select count(*) n from venue_email_events'))[0].n;
 await clubDraft(70);await clubDraft(71,24);
 assert.equal((await rpc('submit_dancer_club_media_batch',[id(1),id(21)])).waitingForCheckIn,true);
 assert.equal((await query('select count(*) n from venue_email_events'))[0].n,emails);
 await checkIn();await tapReceipt();
 const batches=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches;assert.equal(batches.length,1);assert.equal(batches[0].item_count,1);
 assert.equal((await query('select count(*) n from venue_email_events'))[0].n,emails+1);
 assert.deepEqual(await visible(21),original);assert.equal((await query('select status from dancer_profiles where id=$1',[id(11)]))[0].status,'approved');
 await club(batches[0]);assert.deepEqual(await visible(21),original);
 await finish(batches[0]);assert.equal((await visible(21)).length,original.length+1);
 assert.equal((await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches.length,0);
 await tapReceipt();assert.equal((await query('select count(*) n from venue_email_events'))[0].n,emails+1);
 await clubDraft(72);await tapReceipt(21,91,true);assert.equal((await query('select count(*) n from venue_email_events'))[0].n,emails+1);
 await rpc('submit_dancer_club_media_batch',[id(1),id(21)]);assert.equal((await query('select count(*) n from venue_email_events'))[0].n,emails+2);
});
test('tap freezes all existing drafts and waits for processing to send one batch; later uploads stay drafts',async()=>{
 await approvedAtBoth();await clubDraft(70);await clubDraft(71);
 await db.query("update image_moderation_records set status='moderating' where id=$1",[id(71)]);
 await checkIn();await tapReceipt();
 assert.equal((await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches.length,0);
 await clubDraft(72);
 await db.query("update image_moderation_records set status='pending_review' where id=$1",[id(71)]);
 const batches=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches;assert.equal(batches.length,1);assert.equal(batches[0].item_count,2);
 assert.equal((await rpc('get_media_batches',[id(1),'dancer',id(21),null])).draftCount,1);
 assert.equal((await query('select count(*) n from dancer_media_check_in_submissions where completed_at is null'))[0].n,0);
});
test('removing a processing draft releases the frozen batch without publishing the removed file',async()=>{
 await approvedAtBoth();await clubDraft(70);await clubDraft(71);
 await db.query("update image_moderation_records set status='moderating' where id=$1",[id(71)]);
 await checkIn();await tapReceipt();await rpc('edit_dancer_club_media',[id(1),id(21),'photo',id(71),'remove',null]);
 const batch=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches[0];assert.equal(batch.item_count,1);
});

test('rejecting new tapped-in media preserves the previously approved live profile',async()=>{
 await approvedAtBoth();const original=await visible(21);await clubDraft(70);await checkIn();await tapReceipt();
 const batch=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches[0];await club(batch);const result=await finish(batch,[id(70)]);
 assert.deepEqual(await visible(21),original);assert.equal(result.result.outcome,'approved');
 assert.equal((await query('select status from dancer_profiles where id=$1',[id(11)]))[0].status,'approved');
});
test('one tap waits for video processing and combines photos and videos into one review batch',async()=>{
 await approvedAtBoth();await clubDraft(70);await video(71);
 await db.query("update mydancr_tv_videos set editor_venue_id=$1,status='moderating',upload_validation_pending=true where id=$2",[id(21),id(71)]);
 await checkIn();await tapReceipt();assert.equal((await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches.length,0);
 await db.query("update mydancr_tv_videos set status='submitted',upload_validation_pending=false where id=$1",[id(71)]);
 const batches=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches;assert.equal(batches.length,1);assert.equal(batches[0].item_count,2);
});
test('first-time onboarding keeps explicit submission and browser roles cannot read or trigger tap jobs',async()=>{
 await clubDraft(70);await tapReceipt();assert.equal((await query('select count(*) n from dancer_media_check_in_submissions'))[0].n,0);
 for(const role of ['anon','authenticated']){
  for(const sig of ['private.flush_check_in_media(uuid,uuid)','private.capture_check_in_media()','public.submit_dancer_club_media_batch(uuid,uuid)']){
   assert.equal((await query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,sig]))[0].allowed,false);
  }
  assert.equal((await query("select has_table_privilege($1,'public.dancer_media_check_in_submissions','SELECT') allowed",[role]))[0].allowed,false);
 }
});

test('first tap at a new club inherits the latest approved profile of the previous club without inheriting its approval',async()=>{
 const first=await baseline();await club(first);await finish(first);await checkIn(21);await clubDraft(70);
 await rpc('submit_dancer_club_media_batch',[id(1),id(21)]);const update=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches[0];await club(update);await finish(update);
 const latest=(await query('select image_id from image_moderation_records where id=$1',[id(70)]))[0].image_id;
 await rpc('edit_dancer_club_media',[id(1),id(21),'photo',latest,'main',null]);
 const excluded=(await visible(21)).find(r=>r.photoId&&r.photoId!==latest).photoId;
 await rpc('edit_dancer_club_media',[id(1),id(21),'photo',excluded,'remove',null]);const a=await visible(21);
 await db.exec("update shifts set checked_out_at=now()");
 await tapReceipt(24,90,false,true);
 assert.equal((await query('select count(*) n from dancer_media_batches where venue_id=$1',[id(24)]))[0].n,1,'the tap immediately queues Club B review');
 const b=(await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches[0];const review=await detail(b,'venue',4);
 assert.equal(review.items.find(r=>r.isMain)?.id,id(70),'the current Club A main must be labeled correctly in the Club B review');
 assert.equal(review.items.filter(r=>r.isMain).length,1);
 assert.equal(review.items.some(r=>r.record?.image_id===excluded||r.id===excluded),false,'media removed from Club A must not reappear');
 assert.deepEqual(await visible(24),[],'Club A approval is never reused as Club B approval');
 const saved=await chooseAll(b,'venue',[],4);await rpc('submit_club_media_batch',[id(4),b.id,saved.revision]);await finish(b);
 assert.equal((await visible(24)).find(r=>r.isMain)?.photoId,latest);assert.deepEqual(await visible(21),a);
 const inherited=await visible(24);
 await checkIn(21);await clubDraft(71);await rpc('submit_dancer_club_media_batch',[id(1),id(21)]);
 const later=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches[0];await club(later);await finish(later);
 await db.exec("update shifts set checked_out_at=now()");await tapReceipt(24,91);
 assert.deepEqual(await visible(24),inherited,'later Club A changes do not replace Club B media on a return visit');
 assert.equal((await rpc('get_media_batches',[id(4),'venue',id(24),null])).batches.length,0);
});
