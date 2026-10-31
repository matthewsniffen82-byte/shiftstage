import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_FIELDS } from '../src/lib/dancr/compliance-fields.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth; create schema private; grant usage on schema private to service_role;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
 create table app_users(id uuid primary key,email text,role text,admin_workspace_role text default 'owner',account_state text default 'active');
 create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb,sent_at timestamptz);
 create table venue_signup_requests(id uuid primary key,venue_name text,status text);
 create table venues(id uuid primary key,name text,page_review_status text,page_review_notes text,page_reviewed_at timestamptz,updated_at timestamptz default now(),is_active boolean);
 create table venue_club_deal_requests(id uuid primary key,venue_id uuid,offer_title text,request_type text,status text default 'pending');
 create table dmca_cases(id uuid primary key,status text default 'received');create table dmca_counter_notices(id uuid primary key,case_id uuid);
 create table content_reports(id uuid primary key default gen_random_uuid(),reporter_id uuid,target_type text,target_id uuid,target_label text,reason text,details text,status text default 'open',reviewed_by uuid,reviewed_at timestamptz,created_at timestamptz default now());
 alter table content_reports enable row level security;
 create table dancer_profiles(id uuid primary key,user_id uuid,stage_name text,avatar_storage_path text,avatar_source_storage_path text,avatar_source_photo_id uuid,status text default 'approved',is_public boolean default true);
 create type review_status as enum('pending','approved','rejected');
 create table dancer_photos(id uuid primary key,storage_path text,review_status review_status);
 create table image_moderation_records(id uuid primary key,user_id uuid,decision text,upload_context text,club_reviewed_at timestamptz);
 create table mydancr_tv_videos(id uuid primary key,dancer_id uuid,status text,upload_validation_pending boolean,moderation_details jsonb,club_reviewed_at timestamptz,storage_path text,venue_featured boolean,reviewed_by uuid,reviewed_at timestamptz);
 create table shifts(id uuid primary key,status text);
 create table admin_actions(id uuid default gen_random_uuid(),admin_id uuid,target_type text,target_id uuid,action text,notes text);
 create function transition_dancer_publication_safely(p_id uuid,p_action text,p_actor uuid) returns jsonb language plpgsql set search_path=public as $$declare r jsonb;begin update dancer_profiles set status='disabled',is_public=false where id=p_id returning to_jsonb(dancer_profiles.*) into r;return r;end $$;
 create function change_venue_publication_safely(p_actor uuid,p_id uuid,p_action text,p_changes jsonb) returns jsonb language plpgsql set search_path=public as $$declare r jsonb;begin update venues set is_active=false where id=p_id returning to_jsonb(venues.*) into r;return r;end $$;
 grant all on all tables in schema public to service_role;`);
 for(const file of ['20261029030601_admin_review_email_alerts.sql','20261031013745_public_safety_privacy_intake.sql','20261031020951_internal_case_operations.sql']) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 assert.equal((await db.query("select count(*)::int n from compliance_records where status<>'draft'")).rows[0].n,0);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate compliance_events,compliance_records,safety_media_restrictions,content_reports,admin_review_email_deliveries,admin_review_email_events,notifications,dancer_profiles,dancer_photos,mydancr_tv_videos,admin_actions,app_users,auth.users cascade');
 for(const [n,role] of [[1,'admin'],[2,'customer'],[3,'admin']]) {
  await db.query('insert into app_users(id,email,role) values($1,$2,$3)',[id(n),`synthetic${n}@example.invalid`,role]);
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id(n),`synthetic${n}@example.invalid`]);
 }
 await db.exec('set role service_role');
});
async function report({kind='safety',reason='Other safety concern',target=null}={}) {return (await db.query(`insert into content_reports(target_type,target_id,target_label,reason,case_kind,intake,priority) values($1,$2,'Synthetic',$3,$4,'{}','urgent') returning *`,[target?'profile_photo':'contact_message',target?id(target):null,reason,kind])).rows[0];}
const workflow=r=>({ownerId:id(1),backupId:id(3),jurisdiction:'California',authority:'Requester authority checked in restricted evidence.',verification:'not_required',triage:'Reviewed urgency and escalated if needed.',nextAction:'Review follow-up',nextDue:r.next_action_due_at,notices:'Notice sent; private evidence reference synthetic.',decision:'Reviewed and completed action, evidence reference synthetic.',followUp:'No unresolved obligation after synthetic review.',retentionTrigger:'Case closure; draft retention schedule needs adoption.',copySearch:'Known files and derivatives reviewed; synthetic evidence.',verificationDisposal:'No identity documents were collected.'});
const save=(r,w=workflow(r),actor=1)=>db.query('select save_case_workflow($1,$2,$3,$4) r',[id(actor),r.id,r.workflow_revision,w]);
const close=(r,action='resolved')=>db.query('select close_public_case($1,$2,$3,$4) r',[id(1),r.id,action,'Synthetic action evidence and follow-up recorded.']);
async function record(kind,status='draft',fields={},existing=null) {return (await db.query('select save_compliance_record($1,$2,$3,$4,$5,$6,$7) r',[id(1),existing?.id||null,existing?.revision||0,kind,'Synthetic '+kind,status,fields])).rows[0].r;}
const full=kind=>Object.fromEntries(Object.keys(RECORD_FIELDS[kind].fields).map(k=>[k,'Synthetic reviewed evidence']));

test('NCII gets earlier internal target without extending the original 48-hour limit',async()=>{
 const r=await report({reason:'Nonconsensual intimate image'});
 assert.equal(new Date(r.next_action_due_at)-new Date(r.received_at),24*3600000);
 await assert.rejects(save(r,{...workflow(r),nextDue:new Date(Date.parse(r.received_at)+49*3600000).toISOString()}),/48-hour/);
});
test('external receipt preserves the original deadline and audit even when recorded late',async()=>{
 const original=new Date(Date.now()-72*3600000).toISOString();
 const r=(await db.query('select record_external_case($1,$2,$3) r',[id(1),original,{case_kind:'safety',reason:'Nonconsensual intimate image',priority:'urgent',intake:{},details:'Synthetic email case',source:'Mailbox reference'}])).rows[0].r;
 assert.equal(Date.parse(r.received_at),Date.parse(original));assert.equal(Date.parse(r.next_action_due_at)-Date.parse(original),24*3600000);
 assert.equal((await db.query('select count(*)::int n from compliance_events')).rows[0].n,1);
 await assert.rejects(db.query('select record_external_case($1,now()+interval \'1 day\',$2)',[id(1),{case_kind:'safety'}]),/receipt/);
});
test('owner authorization and optimistic revisions prevent unauthorized or stale case edits',async()=>{
 const r=await report(); await assert.rejects(save(r,workflow(r),2),/owner access/);
 const saved=(await save(r)).rows[0].r;assert.equal(saved.workflow_revision,1);
 await assert.rejects(save(r),/changed/);
 await assert.rejects(save(saved,{...workflow(saved),backupId:id(1)}),/must differ/);
});
test('closure requires assigned owner, notices, decision, follow-up and copy review',async()=>{
 const r=await report();await assert.rejects(close(r),/Assign an active case owner/);
 await save(r);const closed=(await close(r)).rows[0].r;assert.equal(closed.status,'resolved');
 assert.equal((await db.query("select count(*)::int n from compliance_events where action='case_resolved'")).rows[0].n,1);
 await assert.rejects(save(closed),/read-only/);
});
test('privacy closure requires verification disposal and authority; extension needs notice',async()=>{
 const r=await report({kind:'privacy',reason:'Delete my information'});
 const w={...workflow(r),jurisdiction:'CA, US',verificationDisposal:'',responseDue:new Date(Date.parse(r.received_at)+60*86400000).toISOString(),deadlineReason:'California request; extension required.'};
 await assert.rejects(save(r,w),/extension reason/);
 const saved=(await save(r,{...w,extensionNotice:'Extension notice sent with reason; evidence reference.'})).rows[0].r;
 await assert.rejects(close(saved),/disposal/);
 await save(saved,{...saved.workflow,verificationDisposal:'No extra verification files collected.'});
 assert.equal((await close(saved)).rows[0].r.status,'resolved');
});
test('urgent restriction succeeds before paperwork, leaves the case open and survives closure',async()=>{
 await db.query("insert into dancer_photos values($1,'synthetic/a','approved'),($2,'synthetic/a','approved')",[id(10),id(11)]);
 const r=await report({target:10});const restricted=(await close(r,'restricted')).rows[0].r;
 assert.equal(restricted.status,'open');assert.equal(restricted.reviewed_at,null);assert.equal(restricted.action_evidence.restriction.affected.length,2);
 assert.equal((await db.query("select count(*)::int n from dancer_photos where review_status='rejected'")).rows[0].n,2);
 await save(restricted);const closed=(await close(restricted)).rows[0].r;
 assert.equal(closed.action_evidence.restriction.affected.length,2);
});
test('registers cannot be verified with missing evidence and retain revision checks',async()=>{
 for(const kind of Object.keys(RECORD_FIELDS)) await assert.rejects(record(kind,'verified'),/Complete/);
 const r=await record('vendor');const saved=await record('vendor','in_progress',{owner:'Named reviewer'},r);assert.equal(saved.revision,2);
 await assert.rejects(record('vendor','draft',{},r),/changed/);
});
test('deletion completion requires an adopted policy and all systems including backups',async()=>{
 const policy=await record('retention');const f={...full('deletion'),triggerAt:'2026-01-01T00:00:00Z',dueAt:'2026-07-01T00:00:00Z',policyId:policy.id,holdId:''};
 await assert.rejects(record('deletion','completed',f),/adopted/);
 await record('retention','verified',full('retention'),policy);
 await assert.rejects(record('deletion','completed',{...f,backups:''}),/backups/);
 assert.equal((await record('deletion','completed',f)).status,'completed');
});
test('active holds cannot be bypassed or unlinked and releasing one preserves the original trigger',async()=>{
 const policy=await record('retention','verified',full('retention'));
 const hold=await record('hold','verified',full('hold'));
 const f={...full('deletion'),triggerAt:'2026-01-01T00:00:00Z',dueAt:'2026-07-01T00:00:00Z',policyId:policy.id,holdId:hold.id};
 const task=await record('deletion','blocked',f);
 await assert.rejects(record('deletion','completed',f,task),/Release/);
 await assert.rejects(record('deletion','completed',{...f,holdId:''},task),/cannot be removed/);
 await record('hold','completed',{...full('hold'),releasedAt:'2026-10-30',releaseEvidence:'Released after restricted evidence review.'},hold);
 await assert.rejects(record('deletion','completed',{...f,triggerAt:'2026-10-30T00:00:00Z'},task),/original deletion trigger/);
 assert.equal((await record('deletion','completed',f,task)).fields.triggerAt,f.triggerAt);
});
test('mailbox alerts are minimal, deduplicated, lease-bound and skip closed cases',async()=>{
 const r=await report(); await db.query('select enqueue_case_alerts()');await db.query('select enqueue_case_alerts()');
 const jobs=(await db.query("select * from admin_review_email_deliveries where mailbox is not null")).rows;assert.equal(jobs.length,1);
 const event=(await db.query("select * from admin_review_email_events where event_key like 'compliance:%'")).rows[0];
 assert.ok(!event.body.includes('Synthetic'));assert.ok(!event.body.includes('example.invalid'));
 // Lease only this mailbox delivery; other owner notifications keep their existing behavior.
 await db.query("update admin_review_email_deliveries set status='sending',lease_id=$1,lease_until=now()+interval '90 seconds' where id=$2",[id(80),jobs[0].id]);
 const target=async lease=>(await db.query('select admin_review_email_target($1,$2) t',[jobs[0].id,lease])).rows[0].t;
 assert.equal(await target(id(81)),null);assert.equal((await target(id(80))).email,'safety@mydancr.com');assert.equal((await target(id(80))).kind,'compliance_case');
 await save(r);await close(r);assert.equal(await target(id(80)),null);
});
test('overdue cases create one escalation per hour, independent of account notifications',async()=>{
 const r=await report();await db.query("update content_reports set next_action_due_at=now()-interval '1 hour' where id=$1",[r.id]);
 await db.query('select enqueue_case_alerts()');await db.query('select enqueue_case_alerts()');
 const rows=(await db.query("select * from admin_review_email_events where event_key like 'compliance:%'")).rows;
 assert.equal(rows.length,1);assert.match(rows[0].title,/overdue/);
});
test('anonymous and authenticated callers cannot read private ledgers or execute operations',async()=>{
 for(const role of ['anon','authenticated']) {
  await db.exec('reset role;set role '+role);
  await assert.rejects(db.query('select * from compliance_records'),/permission denied/);
  await assert.rejects(db.query('select * from compliance_events'),/permission denied/);
  await assert.rejects(db.query('select enqueue_case_alerts()'),/permission denied/);
  await assert.rejects(db.query('select save_case_workflow($1,$2,0,$3)',[id(1),id(10),{}]),/permission denied/);
 }
});
