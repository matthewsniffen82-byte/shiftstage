import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261029060551_explicit_media_submission_batches.sql');
const finalReviewMigration=read('supabase/migrations/'+readdirSync(new URL('../supabase/migrations/',import.meta.url))
 .find(name=>name.endsWith('_finish_eligible_dancer_media_review.sql')));
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
 create table venue_email_events(event_key text primary key,venue_id uuid,body text);
 create table venue_email_deliveries(id uuid primary key,status text,created_at timestamptz);
 create table admin_review_email_events(event_key text primary key,kind text,source_id uuid,title text,body text);
 create table admin_review_email_deliveries(id uuid default gen_random_uuid(),event_key text,recipient_id uuid,notification_id uuid,status text default 'pending',outcome text,finished_at timestamptz,attempts integer default 0,unique(event_key,recipient_id));
 create table dancer_media_email_deliveries(id uuid primary key default gen_random_uuid(),recipient_id uuid,title text,body text,payload jsonb,status text default 'pending',
 attempts integer default 0,created_at timestamptz default now(),next_attempt_at timestamptz default now(),lease_id uuid,lease_until timestamptz,destination text,outcome text,finished_at timestamptz,summary_id uuid);
 create function private.emit_venue_email_event(uuid,text,text,text,text,text,boolean default true) returns void language sql as $$insert into public.venue_email_events values($2,$1,$5) on conflict do nothing$$;
 create function private.dancer_media_review_pending(uuid) returns boolean language sql as $$select false$$;
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
 // Exercise the production claim/audit boundary, which batch fixtures used to omit.
 const adminWorkspace=read('supabase/migrations/20261023042742_admin_operations_workspace.sql');
 await db.exec(`alter table app_users add column display_name text,add column email text default 'fixture@example.invalid';
   alter table auth.users add column email text default 'fixture@example.invalid',add column deleted_at timestamptz,
   add column email_confirmed_at timestamptz default now();`);
 const delivery=read('supabase/migrations/20261027224621_dancer_media_rejection_alerts.sql');
 await db.exec(delivery.slice(delivery.indexOf('create function private.dancer_media_email_account'),delivery.indexOf('create function public.dancer_media_email_target')));
 await db.exec(adminWorkspace.slice(adminWorkspace.indexOf('create or replace function public.assert_admin_workspace_access'),adminWorkspace.indexOf('create or replace view public.admin_media_workspace')));
 await db.exec(`create view public.admin_media_workspace as
 select 'photo'::text kind,id,updated_at,case when decision='review' and club_reviewed_at is not null then 'staff' else 'other' end stage from image_moderation_records
 union all select 'video',id,updated_at,case when status='submitted' and club_reviewed_at is not null then 'staff' else 'other' end from mydancr_tv_videos;
 grant select on admin_media_workspace to service_role;`);
 await db.exec(adminWorkspace.slice(adminWorkspace.indexOf('create or replace function public.claim_admin_media'),adminWorkspace.indexOf('-- Preserve the decisions')));
 await db.exec(read('supabase/migrations/20261031005221_media_batch_admin_review_claims.sql'));
 await db.exec(read('supabase/migrations/20261102030214_dancer_media_workspace.sql'));
 await db.exec(`alter table admin_review_email_deliveries add column mailbox text,add unique(event_key,mailbox);
 alter table club_dancer_approvals add column revision uuid default gen_random_uuid(),add column reviewed_at timestamptz,add column reviewed_by uuid;
 alter table nfc_tags add column tag_type text default 'dressing_room';
 alter table dancer_nfc_enrollments add column completed_at timestamptz,add column last_attempted_at timestamptz,
 add column updated_at timestamptz,add column audit jsonb default '{}';
 alter table venue_dancer_affiliations alter column id set default gen_random_uuid(),add unique(venue_id,dancer_id),
 add column reentry_blocked boolean default false,add column approved_by_user_id uuid,add column approved_at timestamptz,
 add column revoked_by_user_id uuid,add column revoke_reason text,add column updated_at timestamptz;
 create table venue_dancer_affiliation_events(affiliation_id uuid,venue_id uuid,dancer_id uuid,actor_user_id uuid,event_type text,event_payload jsonb);
 create table dancer_age_verifications(user_id uuid,provider text,status text,verified_at timestamptz);`);
 const aliases=read('supabase/migrations/20261101003607_email_alias_routing.sql');
 await db.exec(aliases.slice(aliases.indexOf('create function private.queue_admin_review_alias'),aliases.indexOf('create or replace function public.admin_review_email_target')));
 const profile=read('supabase/migrations/20261027085344_complete_saved_dancer_checkin.sql');
 await db.exec(profile.slice(profile.indexOf('CREATE OR REPLACE FUNCTION public.review_club_dancer_approval_and_check_in'),profile.indexOf("notify pgrst")));
 await db.exec(read('supabase/migrations/20261031005946_club_join_review_scoped_media.sql'));
 const combined=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_unified_club_dancer_review.sql'));
 await db.exec(read('supabase/migrations/'+combined));
 await db.exec(read('supabase/migrations/20261016093521_main_photo_avatar.sql'));
 await db.exec(`alter table dancer_profiles add column city text default 'Las Vegas', add column is_public boolean default false,
   add column venue_approved_by_user_id uuid, add column venue_approved_venue_id uuid;
   alter table shifts add column nfc_last_tapped_at timestamptz;
   create table dancer_agreement_versions(version text primary key,is_current boolean);
   create table dancer_agreement_acceptances(user_id uuid,version text);
   create table dancer_channel_preferences(dancer_id uuid primary key,visibility text,selected_at timestamptz);
   create table dancer_shift_channels(shift_id uuid primary key,dancer_id uuid,venue_id uuid,visibility text,selected_at timestamptz);
   grant all on dancer_age_verifications,dancer_agreement_versions,dancer_agreement_acceptances,dancer_channel_preferences,dancer_shift_channels to service_role;`);
 await db.exec(finalReviewMigration);
 const visibility=read('supabase/migrations/20261102081024_dancer_visibility_alerts.sql');
 await db.exec('create function private.refresh_dancer_visibility_alerts() returns void language sql as $$select$$');
 await db.exec(visibility.slice(visibility.indexOf('create or replace function public.claim_dancer_media_emails()'),visibility.indexOf('revoke all on function private.dancer_visibility_blocker')));
 const emailMigration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_align_dancer_onboarding_emails.sql'));
 await db.exec(read('supabase/migrations/'+emailMigration));
 await db.exec("alter table club_dancer_approvals add column requested_at timestamptz default now(); create table dancer_age_verification_settings(singleton boolean primary key,enabled boolean not null); insert into dancer_age_verification_settings values(true,true); alter table dancer_profiles add column approval_email_recorded_at timestamptz");
 const approvalEmail=read('supabase/migrations/20261028045610_dancer_profile_approval_email.sql');
 await db.exec(approvalEmail.slice(approvalEmail.indexOf('create unique index'),approvalEmail.indexOf('-- Recheck the current account')));
 const retainedReceipt=read('supabase/migrations/20261031101032_lifecycle_retention_and_recovery.sql');
 await db.exec(retainedReceipt.slice(retainedReceipt.indexOf('create or replace function private.queue_dancer_profile_approval_email'),retainedReceipt.indexOf('create function private.retention_original_clock')));
 await db.exec(read('supabase/migrations/20261108092539_resolve_dancer_onboarding_reviews.sql'));
 await db.exec(`alter table venues add column timezone text default 'America/Los_Angeles';
   alter table dancer_profiles add column is_incognito boolean not null default false;
   create function public.has_active_club_deal(public.venues) returns boolean language sql as $$select true$$;
   create function public.is_internal_demo_shift(uuid) returns boolean language sql as $$select false$$;`);
 const rosters=read('supabase/migrations/20261022135605_dancer_incognito_vip_visibility.sql');
 await db.exec(rosters.slice(rosters.indexOf('create or replace function public.internal_roster_members'),rosters.indexOf('create or replace function public.vip_eligible_dancers')));
 const approvalCopy=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_explain_dancer_approval_check_in.sql'));
 await db.exec(read('supabase/migrations/'+approvalCopy));
 const approvalRetries=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_harden_approval_email_retries.sql'));
 await db.exec(read('supabase/migrations/'+approvalRetries));
 const removal=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_remove_rejected_media_from_libraries.sql'));
 await db.exec(read('supabase/migrations/'+removal));
 const totals=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_count_complete_media_review_queue.sql'));
 await db.exec(read('supabase/migrations/'+totals));
 const paging=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_page_media_review_queue.sql'));
 await db.exec(read('supabase/migrations/'+paging));
 const waiting=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_filter_admin_media_review_wait.sql'));
 await db.exec(read('supabase/migrations/'+waiting));
 const failedExtras=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_exclude_unfinished_video_reservations_from_media_submission.sql'));
 await db.exec(read('supabase/migrations/'+failedExtras));
 // Use the real saved-tap receipt for pending batches. Stub shift activation after final media approval.
 await db.exec(`alter function public.complete_saved_dancer_check_in(uuid) rename to fixture_saved_dancer_check_in;
 create function public.complete_saved_dancer_check_in(p_enrollment_id uuid) returns jsonb language plpgsql as $$begin
 if not exists(select 1 from public.dancer_media_batches b join public.dancer_profiles d on d.id=b.dancer_id
   join public.dancer_nfc_enrollments e on e.dancer_user_id=d.user_id and e.venue_id=b.venue_id where e.id=p_enrollment_id and b.state='completed') then
   return public.fixture_saved_dancer_check_in(p_enrollment_id);
 end if;
 update public.dancer_profiles set status='approved',verification_status='approved',venue_approved_at=now(),approved_at=now()
 where user_id=(select dancer_user_id from public.dancer_nfc_enrollments where id=p_enrollment_id);
 return jsonb_build_object('enrollmentStatus','completed','shiftCheckedIn',true);end$$;
 revoke all on function public.complete_saved_dancer_check_in(uuid) from public,anon,authenticated;
 grant execute on function public.complete_saved_dancer_check_in(uuid) to service_role;`);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate admin_review_claims,admin_media_review_events,dancer_age_verifications,venue_dancer_affiliation_events,dancer_agreement_versions,dancer_agreement_acceptances,dancer_channel_preferences,dancer_shift_channels');
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

async function pendingProfile(){
 await db.exec('reset role');
 await query("insert into nfc_tags(id,status,venue_id) values($1,'active',$2)",[id(801),id(21)]);
 await query('update dancer_nfc_enrollments set nfc_tag_id=$1 where dancer_user_id=$2',[id(801),id(1)]);
 await query("insert into dancer_age_verifications values($1,'ondato','verified',now()-interval '1 day')",[id(1)]);
 await query("insert into club_dancer_approvals(venue_id,dancer_id,status,revision) values($1,$2,'pending',$3)",[id(21),id(11),id(88)]);
 await query('delete from venue_dancer_affiliations where dancer_id=$1',[id(11)]);
 await query('insert into auth.users values($1)',[id(6)]);
 await query("insert into app_users(id,role,admin_workspace_role) values($1,'admin','reviewer')",[id(6)]);
 await db.exec('set role service_role');
}
const approveProfile=(revisions,revision=id(88))=>rpc('approve_dancer_with_media_review',[id(2),id(21),id(11),revision,JSON.stringify(revisions)]);

test('a club decline queues one verified dancer email and a renewed request cancels its delivery',async()=>{
 await pendingProfile();await baseline();
 const decline=()=>rpc('review_club_dancer_approval_and_check_in',[id(2),id(21),id(11),id(88),'rejected']);
 assert.equal((await decline()).status,'rejected');
 await assert.rejects(decline(),/CLUB_REQUEST_CHANGED/);
 assert.deepEqual(await query('select recipient_id,title from dancer_media_email_deliveries'),[{recipient_id:id(1),title:'Club request declined'}]);
 assert.deepEqual(await query('select * from admin_review_email_deliveries'),[]);
 const [job]=await query('select * from claim_dancer_media_emails()');
 const target=()=>rpc('dancer_media_email_target',[job.id,job.lease_id]);
 const mail=await target();
 assert.equal(mail.email,'fixture@example.invalid');
 assert.match(mail.body,/Test club declined your request/);
 assert.equal(mail.payload.venueId,id(21));
 assert.deepEqual(await target(),mail);
 assert.deepEqual(await query('select * from claim_dancer_media_emails()'),[]);
 await db.exec('reset role');
 await query('update auth.users set email_confirmed_at=null where id=$1',[id(1)]);
 assert.equal(await target(),null);
 await query('update auth.users set email_confirmed_at=now() where id=$1',[id(1)]);
 await query("update club_dancer_approvals set status='pending',revision=gen_random_uuid() where dancer_id=$1",[id(11)]);
 assert.equal(await target(),null);
});

test('an optional draft does not block the submitted profile or reach reviewers',async()=>{
 await pendingProfile(); const batch=await baseline(); await photo(77);
 const reviewed=await chooseAll(batch);
 assert.ok(reviewed.items.every(item=>item.id!==id(77)));
 assert.equal((await approveProfile({[batch.id]:reviewed.revision})).status,'approved');
 assert.equal((await detail(batch,'admin')).items.length,4);
});

test('declined reviews stay closed until the manager explicitly reopens them',async()=>{
 await pendingProfile(); const batch=await baseline();
 const decide=(revision,status)=>rpc('review_club_dancer_approval_and_check_in',[id(2),id(21),id(11),revision,status]);
 const declined=await decide(id(88),'rejected');
 await assert.rejects(club(batch),/declined/);
 assert.equal((await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches.length,0);
 assert.deepEqual(await query('select * from admin_review_email_events'),[]);
 await assert.rejects(decide(id(88),'pending'),/CHANGED/);
 const reopened=await decide(declined.revision,'pending');
 const review=await chooseAll(batch);
 assert.equal((await approveProfile({[batch.id]:review.revision},reopened.revision)).status,'approved');
 assert.equal((await detail(batch,'admin')).state,'admin');
});

test('a club-specific onboarding video goes only to that club even when another club opens its queue',async()=>{
 await pendingProfile();await tapReceipt(24,92,false,true);
 const initial=await baseline(); await approveProfile({[initial.id]:(await chooseAll(initial)).revision});
 assert.equal((await finish(initial,[id(43)])).result.outcome,'needs_media');
 await video(78);await query('update mydancr_tv_videos set editor_venue_id=$1 where id=$2',[id(21),id(78)]);
 assert.equal((await rpc('submit_dancer_media_batch',[id(1)])).submitted,0);
 assert.equal((await rpc('submit_dancer_club_media_batch',[id(1),id(21)])).submitted,1);
 await rpc('get_media_batches',[id(4),'venue',id(24),null]);
 const rows=await query('select id,venue_id from dancer_media_batches where items @> $1::jsonb',[JSON.stringify([{id:id(78)}])]);
 assert.deepEqual(rows.map(row=>row.venue_id),[id(21)]);
 await club(rows[0]);assert.equal((await finish(rows[0])).result.outcome,'approved');
});

test('stale missing-media mail is skipped after the same club meets the requirements',async()=>{
 await pendingProfile(); const main=await baseline();await photo(77);await submit();
 const batches=(await rpc('get_media_batches',[id(2),'venue',id(21),id(11)])).batches;
 const extra=batches.find(b=>b.id!==main.id);
 await approveProfile({[main.id]:(await chooseAll(main)).revision,[extra.id]:(await chooseAll(extra)).revision});
 assert.match((await finish(extra)).result.outcome,/^needs_/);
 assert.equal((await finish(main)).result.outcome,'approved');
 const jobs=[...await query('select * from claim_dancer_media_emails()'),...await query('select * from claim_dancer_media_emails()')];
 assert.equal(jobs.length,2);
 const targets=await Promise.all(jobs.map(job=>rpc('dancer_media_email_target',[job.id,job.lease_id])));
 assert.deepEqual(targets.filter(Boolean).map(target=>target.title),['Your profile is approved']);
});

test('the last requirement unlocking the dashboard sends one current approval email',async()=>{
 await withReviewedClub(async batch=>{
   await db.exec('delete from dancer_agreement_acceptances;delete from dancer_nfc_enrollments');
   assert.equal((await finish(batch)).result.outcome,'media_ready');
   await query("insert into dancer_agreement_acceptances values($1,'current')",[id(1)]);
   for(let attempt=0;attempt<2;attempt++)await rpc('finalize_pending_dancer_nfc_enrollment',[id(1),null,{}]);
   const jobs=[...await query('select * from claim_dancer_media_emails()'),...await query('select * from claim_dancer_media_emails()')];
   assert.equal(jobs.length,2);
   const targets=await Promise.all(jobs.map(job=>rpc('dancer_media_email_target',[job.id,job.lease_id])));
   assert.deepEqual(targets.filter(Boolean).map(target=>[target.title,target.email]),[['Your profile is approved','fixture@example.invalid']]);
   assert.match(targets.find(Boolean).body,/no active check-in.*tap the club’s dancer check-in tag/i);
 });
});

test('unprepared approval retries become visible and terminate without changing a live lease',async()=>{
 await withReviewedClub(async batch=>{
   await finish(batch);
   const health=async()=>(await query('select dancer_media_email_queue_needs_attention() flag'))[0].flag;
   assert.equal(await health(),false);
   const [job]=await query('select * from claim_dancer_media_emails()');
   await query("update dancer_media_email_deliveries set attempts=5,created_at=now()-interval '30 minutes' where id=$1",[job.id]);
   assert.equal(await health(),true);
   assert.deepEqual(await query('select * from claim_dancer_media_emails()'),[]);
   assert.equal((await query('select status from dancer_media_email_deliveries where id=$1',[job.id]))[0].status,'sending');
   await query("update dancer_media_email_deliveries set lease_until=now()-interval '1 second' where id=$1",[job.id]);
   assert.deepEqual(await query('select * from claim_dancer_media_emails()'),[]);
   assert.deepEqual(await query('select status,outcome,destination from dancer_media_email_deliveries where id=$1',[job.id]),
     [{status:'failed',outcome:'target_retry_exhausted',destination:null}]);
   assert.equal(await health(),true);
 });
});

test('a fresh tap renews the request once after expiry and never changes an approved request',async()=>{
 await pendingProfile();await db.exec("update dancer_nfc_enrollments set tapped_at=now()-interval '8 days',expires_at=now()-interval '1 day'");
 const tap=()=>db.exec("update dancer_nfc_enrollments set tapped_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days'");
 const request=async()=>(await query('select revision,requested_at from club_dancer_approvals'))[0];
 const old=await request();await tap();const renewed=await request();
 assert.notEqual(renewed.revision,old.revision);await tap();assert.deepEqual(await request(),renewed);
 await db.exec("update club_dancer_approvals set status='approved';update dancer_nfc_enrollments set expires_at=now()-interval '1 day'");
 await tap();assert.deepEqual(await request(),renewed);
});

test('the verification setting cannot be disabled',async()=>{
 await db.exec('reset role');
 await assert.rejects(db.exec('update dancer_age_verification_settings set enabled=false'),/dancer_age_verification_always_required/);
});

test('one club approval commits the affiliation and all reviewed batches with one shared email',async()=>{
 await pendingProfile();
 const first=await baseline();
 await photo(44);await rpc('submit_dancer_media_batch',[id(1)]);
 const batches=(await rpc('get_media_batches',[id(2),'venue',id(21),id(11)])).batches;
 assert.equal(batches.length,2);
 const second=batches.find(b=>b.id!==first.id);
 const revisions={[first.id]:(await chooseAll(first)).revision,[second.id]:second.revision};
 await assert.rejects(approveProfile(revisions),/Review every item/);
 revisions[second.id]=(await chooseAll(second)).revision;
 await assert.rejects(approveProfile({...revisions,[second.id]:id(99)}),/CLUB_MEDIA_BATCHES_CHANGED/);
 await assert.rejects(approveProfile({...revisions,[id(97)]:id(98)}),/CLUB_MEDIA_BATCHES_CHANGED/);
 await assert.rejects(approveProfile(revisions,id(99)),/CLUB_REQUEST_CHANGED/);
 assert.deepEqual(await query('select distinct state from dancer_media_batches'),[{state:'club'}]);
 assert.deepEqual(await query('select status from club_dancer_approvals'),[{status:'pending'}]);
 assert.deepEqual(await query('select * from club_media_permissions'),[]);
 assert.deepEqual(await query('select * from admin_review_email_deliveries'),[]);
 assert.deepEqual(await query("select id from notifications where payload->>'kind'='admin_review'"),[]);

 const result=await approveProfile(revisions);
 assert.equal(result.status,'approved');assert.equal(result.affiliationActivated,true);assert.equal(result.checkInStatus,'media_batch_pending');
 assert.equal(result.shiftCheckedIn,false);assert.equal(result.requiresNewTap,false);
 assert.deepEqual(await query('select status from venue_dancer_affiliations'),[{status:'active'}]);
 assert.deepEqual(await query('select state from dancer_media_batches'),[{state:'admin'},{state:'admin'}]);
 const expected=[{mailbox:'approvals@mydancr.com',recipient_id:null}];
 assert.deepEqual(await query('select mailbox,recipient_id from admin_review_email_deliveries'),expected);
 assert.match((await query('select body from admin_review_email_events'))[0].body,/Approve or reject each item.*“Submit media review”/);
 assert.deepEqual(await query('select * from dancer_media_email_deliveries'),[]);
 assert.deepEqual(await query("select recipient_id from notifications where payload->>'reviewKind'='media_approval' order by recipient_id"),
  [{recipient_id:id(3)},{recipient_id:id(6)}]);
 await assert.rejects(approveProfile(revisions),/CLUB_MEDIA_BATCHES_CHANGED|CLUB_REQUEST_CHANGED/);
 assert.deepEqual(await query('select mailbox,recipient_id from admin_review_email_deliveries'),expected);
});

test('previously forwarded media can finish profile approval without another email',async()=>{
 await pendingProfile();const batch=await baseline();await club(batch);
 assert.equal((await approveProfile({})).status,'approved');
 assert.deepEqual(await query('select mailbox,recipient_id from admin_review_email_deliveries'),[{mailbox:'approvals@mydancr.com',recipient_id:null}]);
 for(const role of ['anon','authenticated'])assert.equal((await query(
  "select has_function_privilege($1,'public.approve_dancer_with_media_review(uuid,uuid,uuid,uuid,jsonb)','execute') ok",[role]))[0].ok,false);
});

test('approving a new profile still requires at least one accepted photo',async()=>{
 await pendingProfile();const batch=await baseline();
 const saved=await chooseAll(batch,'venue',[id(40),id(41),id(42)]);
 await assert.rejects(approveProfile({[batch.id]:saved.revision}),/CLUB_PROFILE_MEDIA_REVIEW_REQUIRED/);
 assert.deepEqual(await query('select status from club_dancer_approvals'),[{status:'pending'}]);
 assert.deepEqual(await query('select state from dancer_media_batches'),[{state:'club'}]);
 assert.deepEqual(await query('select * from admin_review_email_deliveries'),[]);
});

// Run the real saved-check-in gates for these cases. A rollback restores the
// short shift stub used by the older, media-only tests.
async function withReviewedClub(run) {
 await db.exec(`begin; reset role;
   alter function public.complete_saved_dancer_check_in(uuid) rename to fixture_media_only_check_in;
   alter function public.fixture_saved_dancer_check_in(uuid) rename to complete_saved_dancer_check_in;
   set role service_role;`);
 try {
   await pendingProfile();
   await query("insert into dancer_agreement_versions values('current',true)");
   await query("insert into dancer_agreement_acceptances values($1,'current')",[id(1)]);
   await photo(44);
   const batch=await baseline();
   await approveProfile({[batch.id]:(await chooseAll(batch)).revision});
   await run(batch);
 } finally {await db.exec('rollback');}
}

test('final approval resolves the main avatar before the saved tap and never queues its automatic crop',async()=>{
 await withReviewedClub(async batch=>{
   const [main]=await query('select final_storage_path as path from image_moderation_records where id=$1',[id(40)]);
   await query("insert into storage.objects values('dancer-photos',$1)",[main.path+'.avatar.jpg']);
   await query(`update dancer_nfc_enrollments set audit=jsonb_build_object('visibility','internal','sessionId',$1::text)`,[id(98)]);
   await db.exec(`reset role;
     alter function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) rename to fixture_activate_dancer_shift;
     create function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) returns jsonb language sql as
     $$select jsonb_build_object('shiftCheckedIn',true,'venueId',venue_id,'shiftId',gen_random_uuid()) from public.nfc_tags where id=$1$$;
     set role service_role;`);
   const result=await finish(batch,[id(44)]);
   assert.equal(result.result.outcome,'approved');
   assert.equal(result.result.title,'Your profile is approved');
   assert.deepEqual(await query('select status from dancer_nfc_enrollments'),[{status:'completed'}]);
   assert.deepEqual(await query('select visibility from dancer_shift_channels'),[{visibility:'internal'}]);
   const [profile]=await query('select status,is_public,avatar_storage_path from dancer_profiles where id=$1',[id(11)]);
   assert.equal(profile.avatar_storage_path,main.path+'.avatar.jpg');
   assert.equal(profile.status,'approved');assert.equal(profile.is_public,false);
   const countBefore=await query('select count(*) n from venue_email_events');
   for(let attempt=0;attempt<2;attempt++) assert.equal((await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches.length,0);
   assert.deepEqual(await query('select count(*) n from venue_email_events'),countBefore);
   await query("update dancer_profiles set avatar_storage_path='independent-avatar.jpg' where id=$1",[id(11)]);
   const next=(await rpc('get_media_batches',[id(2),'venue',id(21),null])).batches;
   assert.equal(next.length,1);assert.equal(next[0].item_count,1);
   const clubEmails=await query('select body from venue_email_events');
   assert.ok(clubEmails.some(row=>row.body.includes('1 media item ready for review')));
   assert.ok(clubEmails.some(row=>row.body.includes('media items ready for review')));
 });
});

test('fully reviewed media unlocks the dashboard after an expired tap without starting a shift',async()=>{
 await withReviewedClub(async batch=>{
   await db.exec("update dancer_nfc_enrollments set expires_at=now()-interval '1 hour',tapped_at=now()-interval '8 days',audit=jsonb_build_object('visibility','both')");
   await query("update dancer_age_verifications set verified_at=now()-interval '9 days'");
   const result=await finish(batch,[id(44)]);
   assert.equal(result.result.outcome,'approved');
   assert.deepEqual(await query('select status,verification_status,is_public from dancer_profiles where id=$1',[id(11)]),
     [{status:'approved',verification_status:'approved',is_public:false}]);
   assert.deepEqual(await query('select status from dancer_nfc_enrollments'),[{status:'pending'}]);
   assert.deepEqual(await query('select * from shifts'),[]);
   assert.deepEqual(await query('select * from dancer_shift_channels'),[]);
   const [job]=await query('select * from claim_dancer_media_emails()');
   const mail=await rpc('dancer_media_email_target',[job.id,job.lease_id]);
   assert.equal(mail.title,'Your profile is approved');
   assert.match(mail.body,/no active check-in/);
   assert.match(mail.body,/1 photo wasn’t approved. Replacements are optional/);
 });
});

for (const visibility of ['internal','external','both']) {
 test('approval email reports the saved check-in with '+visibility+' visibility',async()=>{
  await withReviewedClub(async batch=>{
   await query("update dancer_nfc_enrollments set audit=jsonb_build_object('visibility',$1::text,'sessionId',$2::text)",[visibility,id(98)]);
   // The NFC fixture returns an activation receipt. Persist its matching shift
   // so the email reads actual presence through the production roster query.
   await db.exec(`reset role;
     alter function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) rename to fixture_activate_dancer_shift;
     create function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) returns jsonb language sql as $$
       with live as (insert into public.shifts(dancer_id,venue_id,status,checked_in_at,location_status,location_verification_expires_at)
         select d.id,t.venue_id,'posted',now()-interval '10 minutes','club_confirmed',now()+interval '5 hours 50 minutes'
         from public.nfc_tags t join public.dancer_profiles d on d.user_id=$2 where t.id=$1 returning id,venue_id)
       select jsonb_build_object('shiftCheckedIn',true,'venueId',venue_id,'shiftId',id) from live $$;
     set role service_role;`);
   const result=await finish(batch,[id(44)]);
   assert.equal(result.result.outcome,'approved');
   const [job]=await query('select * from claim_dancer_media_emails()');
   const target=()=>rpc('dancer_media_email_target',[job.id,job.lease_id]);
   const mail=await target();
   assert.equal(mail.title,'Your profile went live at Test club');
   const [{starts,ends}]=await query(`select to_char(checked_in_at at time zone 'America/Los_Angeles','Mon FMDD "at" FMHH12:MI AM') starts,
     to_char(location_verification_expires_at at time zone 'America/Los_Angeles','Mon FMDD "at" FMHH12:MI AM') ends from shifts`);
   assert.ok(mail.body.startsWith('You checked in at Test club on '+starts+' (club time). Your scheduled end time was '+ends+'.'));
   assert.equal(mail.body.includes('club roster'),visibility!=='external');
   assert.equal(mail.body.includes('Working now on public MyDancr'),visibility!=='internal');
   assert.match(mail.body,/\n\n1 photo wasn’t approved. Replacements are optional\./);
   await db.exec('update shifts set checked_out_at=now()');
   assert.deepEqual(await target(),mail);
  });
 });
}

test('dashboard activation without a saved tap still requires current agreement, age, active club access and sufficient media',async()=>{
 await withReviewedClub(async batch=>{
   await db.exec("delete from dancer_nfc_enrollments;delete from dancer_agreement_acceptances");
   assert.equal((await finish(batch)).result.outcome,'media_ready');
   const status=async()=> (await query('select status from dancer_profiles where id=$1',[id(11)]))[0].status;
   const retry=()=>rpc('finalize_pending_dancer_nfc_enrollment',[id(1),null,{}]);
   assert.equal(await status(),'pending_review');
   await query("insert into dancer_agreement_acceptances values($1,'current')",[id(1)]);
   await db.exec("update dancer_age_verifications set status='pending'");
   await retry();assert.equal(await status(),'pending_review');
   await db.exec("update dancer_age_verifications set status='verified';update venue_dancer_affiliations set revoked_at=now()");
   await retry();assert.equal(await status(),'pending_review');
   await db.exec("update venue_dancer_affiliations set revoked_at=null;update club_media_permissions set decision='rejected' where source='video'");
   await retry();assert.equal(await status(),'pending_review');
   await db.exec("update club_media_permissions set decision='approved' where source='video'");
   assert.equal((await retry()).profileActivated,true);assert.equal(await status(),'approved');
   assert.equal((await retry()).shiftCheckedIn,false);assert.deepEqual(await query('select * from shifts'),[]);
 });
});

test('repair removes only the untouched generated-avatar batch and unlocks the eligible profile once',async()=>{
 await withReviewedClub(async batch=>{
   await db.exec('delete from dancer_nfc_enrollments;delete from dancer_agreement_acceptances');
   await finish(batch);
   await query("insert into dancer_agreement_acceptances values($1,'current')",[id(1)]);
   const [{version}]=await query('select private.generated_main_avatar_version($1) as version',[id(11)]);
   assert.ok(version);
   const item={key:'avatar:'+id(11),id:id(11),source:'avatar',kind:'photo',version};
   for(const [n,items] of [[91,[item]],[92,[{...item,version:'independent'}]],[93,[item,{key:'other'}]]]){
     await query('insert into dancer_media_batches(id,dancer_id,venue_id,items) values($1,$2,$3,$4)',[id(n),id(11),id(21),JSON.stringify(items)]);
   }
   const cleanup=finalReviewMigration.match(/delete from public\.dancer_media_batches b[\s\S]*?\n  \);/)[0];
   const repair=finalReviewMigration.slice(finalReviewMigration.indexOf('do $repair$'));
   for(let retry=0;retry<2;retry++){await db.exec(cleanup);await db.exec(repair);}
   assert.deepEqual(await query("select id from dancer_media_batches where state='club' order by id"),[{id:id(92)},{id:id(93)}]);
   assert.deepEqual(await query('select status from dancer_profiles where id=$1',[id(11)]),[{status:'approved'}]);
   assert.deepEqual(await query('select * from shifts'),[]);
   assert.deepEqual(await query("select title from dancer_media_email_deliveries where payload->>'dashboardUnlocked'='true'"),[{title:'Your profile is approved'}]);
 });
});

test('individual media review emails route to the shared inbox while other review categories keep individual delivery',async()=>{
 for(const kind of ['media_approval','club_application']){
  await query('insert into admin_review_email_events(event_key,kind) values($1,$1)',[kind]);
  await query('insert into admin_review_email_deliveries(event_key,recipient_id) values($1,$2)',[kind,id(3)]);
 }
 assert.deepEqual(await query('select event_key,recipient_id,mailbox from admin_review_email_deliveries order by event_key,recipient_id nulls last'),[
  {event_key:'club_application',recipient_id:id(3),mailbox:null},
  {event_key:'club_application',recipient_id:null,mailbox:'approvals@mydancr.com'},
  {event_key:'media_approval',recipient_id:null,mailbox:'approvals@mydancr.com'},
 ]);
});

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
 assert.equal((await query("select count(*) n from admin_media_review_events where stage='mydancr'"))[0].n,4);
 assert.equal((await query('select count(*) n from admin_review_claims'))[0].n,0);
 assert.equal((await rpc('get_dancer_media_review_outcome',[id(1)])).body,result.result.body);
});

test('batch publication respects another reviewer claim and rolls back the whole batch',async()=>{
 const b=await baseline();await club(b);const saved=await chooseAll(b,'admin');
 await db.query('insert into auth.users values($1)',[id(6)]);
 await db.query("insert into app_users(id,role) values($1,'admin')",[id(6)]);
 const [{updated_at}]=await query('select updated_at from mydancr_tv_videos where id=$1',[id(43)]);
 await rpc('claim_admin_media',[id(6),'video',id(43),updated_at]);
 await assert.rejects(rpc('submit_admin_media_batch',[id(3),b.id,saved.revision]),/Another reviewer/);
 assert.equal((await query('select count(*) n from dancer_photos'))[0].n,0);
 assert.equal((await detail(b,'admin')).state,'admin');
 await rpc('claim_admin_media',[id(6),'video',id(43),updated_at,true]);
 assert.equal((await rpc('submit_admin_media_batch',[id(3),b.id,saved.revision])).state,'completed');
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
for (const venue of [null, id(21)]) test(`ready media submits around retryable extras in the ${venue ? 'club' : 'onboarding'} editor`, async () => {
 await photo(40, true); await photo(41); await photo(42); await video(43); await photo(44);
 await db.query("update image_moderation_records set editor_venue_id=$1", [venue]);
 await db.query("update image_moderation_records set status='moderation_retry' where id=$1", [id(44)]);
 await db.query("update mydancr_tv_videos set editor_venue_id=$1", [venue]);
 await db.query(`insert into mydancr_tv_videos(id,dancer_id,submitted_by,editor_venue_id,status,upload_validation_pending,moderation_started_at,moderation_completed_at)
   values ($1,$2,$3,$4,'uploading',false,null,null),
          ($5,$2,$3,$4,'submitted',true,now(),now()),
          ($6,$2,$3,$4,'moderating',true,now(),null)`, [id(45),id(11),id(1),venue,id(46),id(47)]);
 const status=()=>rpc('get_media_batches',[id(1),'dancer',venue,null]);
 const send=()=>venue ? rpc('submit_dancer_club_media_batch',[id(1),venue]) : rpc('submit_dancer_media_batch',[id(1)]);
 assert.equal((await status()).processingCount,1);
 await assert.rejects(send(),/processing/);
 await db.query("update mydancr_tv_videos set moderation_started_at=now()-interval '6 minutes' where id=$1", [id(47)]);
 const ready=await status(); assert.equal(ready.processingCount,0); assert.equal(ready.draftCount,4);
 assert.equal((await send()).submitted,4);
 const [{items}]=await query('select items from dancer_media_submissions');
 assert.deepEqual(items.map(item=>item.id).sort(),[40,41,42,43].map(id));
 await db.query("update mydancr_tv_videos set status='submitted',moderation_details=$2 where id=$1", [id(45),{fileChecksPassed:true,preparedPublication:{storagePath:'private/video.mp4'}}]);
 assert.deepEqual((await status()).draftItems.map(item=>item.id),[id(45)]);
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
 const beforeSubmit=await rpc('dancer_club_media_statuses',[id(1)]);
 assert.equal(beforeSubmit.find(r=>r.venueId===id(24)&&r.id===id(rejected)).hidden,false);
 const result=await rpc('submit_club_media_batch',[id(4),other.id,choices.revision]);
 assert.equal(result.state,'completed');assert.equal(result.result.clubEligible,false);
 assert.deepEqual(await visible(24),[]);assert.deepEqual(await visible(21),original);
 const requirements=await rpc('dancer_club_media_requirements',[id(1)]);
 assert.equal(requirements.find(r=>r.venueId===id(21)).eligible,true);assert.equal(requirements.find(r=>r.venueId===id(24)).eligible,false);
 const statuses=await rpc('dancer_club_media_statuses',[id(1)]);
 assert.equal(statuses.find(r=>r.venueId===id(24)&&r.id===id(rejected)).status,'rejected');
 assert.equal(statuses.find(r=>r.venueId===id(24)&&r.id===id(rejected)).hidden,true);
 assert.equal(statuses.find(r=>r.venueId===id(21)&&r.id===id(rejected)).hidden,false);
 const rejectedPhotos=venue=>rpc('club_rejected_review_photos',[id(venue),[id(11)]]);
 assert.deepEqual(await rejectedPhotos(21),[]);
 assert.deepEqual((await rejectedPhotos(24)).map(r=>r.media_id),rejected===43?[]:[id(rejected)]);
});
test('expired and feed-only videos cannot satisfy a club minimum',async()=>{
 await approvedAtBoth();
 await db.exec("update mydancr_tv_videos set expires_at=now()-interval '1 day'");assert.deepEqual(await visible(21),[]);
 await db.exec("update mydancr_tv_videos set expires_at=now()+interval '1 day',distribution_scope='feed_only'");assert.deepEqual(await visible(21),[]);
});
test('browser roles cannot read private club inventories or finish review batches',async()=>{
 for(const role of ['anon','authenticated'])for(const signature of ['public.club_approved_media(uuid,uuid[])','public.dancer_club_media_requirements(uuid)',
 'public.club_rejected_review_photos(uuid,uuid[])','private.club_media_eligibility(uuid,uuid[])','private.club_media_ready(uuid,uuid)','private.finish_resolved_club_media_batch(uuid,jsonb,uuid)']){
  assert.equal((await query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature]))[0].allowed,false);
 }
});
test('dancers can select another connected media club while their verified check-in stays unchanged',async()=>{
 await approvedAtBoth();
 for(const club of [21,24])assert.equal((await rpc('dancer_media_editor_context',[id(1),id(club)])).venueId,id(club));
 await assert.rejects(rpc('dancer_media_editor_context',[id(1),id(999)]),/connected clubs/);
 await db.query("insert into shifts(dancer_id,venue_id,status,checked_in_at,location_status,location_verification_expires_at) values($1,$2,'posted',now(),'club_confirmed',now()+interval '1 hour')",[id(11),id(21)]);
 assert.equal((await rpc('dancer_media_editor_context',[id(1),null])).venueId,id(21));
 assert.equal((await rpc('dancer_media_editor_context',[id(1),id(24)])).venueId,id(24));
 assert.equal((await rpc('submit_dancer_club_media_batch',[id(1),id(24)])).waitingForCheckIn,true);
 assert.equal((await query('select venue_id from shifts where checked_out_at is null'))[0].venue_id,id(21));
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
 const update=await finish(batches[0]);assert.equal((await visible(21)).length,original.length+1);
 assert.equal(update.result.title,'Media review complete for Test club');assert.equal(update.result.action,'View club results');
 assert.match(update.result.body,/media review is complete/i);
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
 assert.equal(result.result.title,'Media review complete for Test club');assert.match(result.result.body,/Not approved: 1 photo/);
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


test('workspace draft counts, processing and submission labels stay scoped to the selected club',async()=>{
 await approvedAtBoth();await checkIn(21);await clubDraft(70);await clubDraft(71,24);await video(72);
 await db.query("update mydancr_tv_videos set editor_venue_id=$1 where id=$2",[id(21),id(72)]);
 let queue=await rpc('get_media_batches',[id(1),'dancer',id(21),null]);
 assert.deepEqual(queue.draftItems.map(x=>x.kind).sort(),['photo','video']);assert.equal(queue.draftCount,2);
 let rows=await rpc('dancer_club_media_statuses',[id(1)]);
 assert.ok(rows.some(x=>x.status==='approved'));
 assert.ok(rows.filter(x=>x.status==='approved').every(x=>x.submissionState==='approved'),'existing club-approved media must stay approved');
 assert.equal(rows.find(x=>x.id===id(70)&&x.venueId===id(21)).submissionState,'draft');
 await db.query("update image_moderation_records set status='moderating' where id=$1",[id(70)]);
 queue=await rpc('get_media_batches',[id(1),'dancer',id(21),null]);assert.equal(queue.processingCount,1);
 const other=await rpc('get_media_batches',[id(1),'dancer',id(24),null]);assert.equal(other.processingCount,0);assert.equal(other.draftCount,1);
 await db.query("update image_moderation_records set status='pending_review' where id=$1",[id(70)]);
 await rpc('submit_dancer_club_media_batch',[id(1),id(21)]);
 rows=await rpc('dancer_club_media_statuses',[id(1)]);
 assert.equal(rows.find(x=>x.id===id(70)&&x.venueId===id(21)).submissionState,'pending');
 assert.equal(rows.find(x=>x.id===id(71)&&x.venueId===id(24)).submissionState,'draft');
 for(const role of ['anon','authenticated'])assert.equal((await query("select has_function_privilege($1,'public.dancer_club_media_statuses(uuid)','EXECUTE') allowed",[role]))[0].allowed,false);
});

test('the full reviewer count is independent of the first hundred batches and respects role and club',async()=>{
 const reviewItems=[{key:'one'},{key:'two'}];
 await db.query("insert into dancer_media_batches(dancer_id,venue_id,items,club_decisions) select $1,$2,$3::jsonb,$4::jsonb from generate_series(1,101)",[id(11),id(21),JSON.stringify(reviewItems),JSON.stringify({one:{decision:'approved'},two:{decision:'rejected'}})]);
 const queue=(role,actor,venue)=>rpc('get_media_batches',[actor,role,venue,null]);
 const club=await queue('venue',id(2),id(21));assert.equal(club.batches.length,100);assert.equal(club.count,202);
 const second=await rpc('get_media_batches_page',[id(2),'venue',id(21),null,1]);
 assert.equal(second.count,202);assert.equal(second.batchCount,101);assert.equal(second.batches.length,1);
 assert.ok(!club.batches.some(batch=>batch.id===second.batches[0].id));
 const empty=await rpc('get_media_batches_page',[id(2),'venue',id(21),null,2]);
 assert.equal(empty.batches.length,0);assert.equal(empty.count,202);
 const other=await queue('venue',id(4),id(24));assert.equal(other.count,0);
 await db.exec("update dancer_media_batches set state='admin'");
 const admin=await queue('admin',id(3),null);assert.equal(admin.count,101);assert.equal(admin.batches.length,100);assert.ok(admin.batches.every(b=>b.item_count===1));
 await db.exec("update dancer_media_batches set club_submitted_at=now()-interval '25 hours'");
 await db.exec("update dancer_media_batches set club_submitted_at=now() where id=(select min(id::text)::uuid from dancer_media_batches)");
 const aged=(page,countOnly)=>rpc('get_media_batches_page',[id(3),'admin',null,null,page,24,countOnly]);
 const first=await aged(0,false);assert.equal(first.count,100);assert.equal(first.batches.length,100);
 assert.ok(first.batches.every(b=>b.item_count===1));
 assert.equal((await aged(1,false)).batches.length,0);
 const totals=await aged(0,true);assert.equal(totals.count,first.count);assert.equal(totals.batches.length,0);
 await db.exec("update dancer_media_batches set state='club'");
 assert.equal((await aged(0,true)).count,0,'old uploads still at the club are outside the staff queue');
 for(const role of ['anon','authenticated'])assert.equal((await query("select has_function_privilege($1,'public.get_media_batches_page(uuid,text,uuid,uuid,integer,integer,boolean)','EXECUTE') allowed",[role]))[0].allowed,false);
});
