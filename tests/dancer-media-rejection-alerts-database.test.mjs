import assert from 'node:assert/strict';
import test,{before,beforeEach,afterEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 grant usage on schema private to service_role;
 create table public.app_users(id uuid primary key,role text,account_state text,email text);
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz);
 create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb);
 create table public.venues(id uuid primary key,name text);
 create table public.dancer_profiles(id uuid primary key,user_id uuid,status text);
 create table public.image_moderation_records(id uuid primary key,user_id uuid,decision text,upload_context text);
 create table public.mydancr_tv_videos(id uuid primary key,submitted_by uuid,status text);
 create table public.club_media_permissions(dancer_id uuid,media_id uuid,source text,venue_id uuid,decision text,content_version text);
 create table public.test_media(id uuid,dancer_id uuid,user_id uuid,kind text,source text,content_version text,is_main boolean,record jsonb);
 create function public.dancer_club_media(uuid[]) returns setof public.test_media language sql as 'select * from public.test_media where dancer_id=any($1)';
 insert into public.app_users values('${id(1)}','dancer','active','dancer@example.invalid');
 insert into auth.users values('${id(1)}','dancer@example.invalid',now(),null);
 insert into public.dancer_profiles values('${id(2)}','${id(1)}','pending_review');
 insert into public.venues values('${id(3)}','Spearmint Rhino'),('${id(4)}','Other club');
 insert into public.test_media values('${id(5)}','${id(2)}','${id(1)}','photo','upload','v1',true,'{"status":"pending_review"}');
 insert into public.club_media_permissions values('${id(2)}','${id(5)}','upload','${id(3)}','rejected','v1');
 grant select,insert,update,delete on all tables in schema public to service_role;`);
 await pg.exec(readFileSync('supabase/migrations/20261027224621_dancer_media_rejection_alerts.sql','utf8'));
});
beforeEach(()=>pg.exec('begin'));
afterEach(()=>pg.exec('rollback'));
after(()=>pg.close());
const query=async(sql,args=[])=>(await pg.query(sql,args)).rows;

test('existing rejected main photo gets one actionable inbox notice and durable email',async()=>{
 const [notice]=await query('select * from notifications');
 assert.equal(notice.title,'Main photo needs replacing');
 assert.match(notice.body,/Spearmint Rhino.*main photo.*avatar updates automatically/);
 assert.equal(notice.payload.emailPath,'/dashboard/dancer#dancer-main-photo');
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,1);
 await pg.exec('delete from notifications');
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,1);
});
test('unchanged club rejection does not duplicate, but a new content decision does',async()=>{
 await pg.exec("update club_media_permissions set decision='rejected'");
 assert.equal((await query('select * from notifications')).length,1);
 await pg.exec("update test_media set content_version='v2';update club_media_permissions set content_version='v2'");
 assert.equal((await query('select * from notifications')).length,2);
});
test('photo rejection commits the notice and email with the decision',async()=>{
 await pg.exec(`insert into image_moderation_records values('${id(6)}','${id(1)}','review','profile_main');
 update image_moderation_records set decision='rejected' where id='${id(6)}';
 update image_moderation_records set decision='rejected' where id='${id(6)}';`);
 const notices=await query("select * from notifications where payload->>'reviewScope'='platform'");
 assert.equal(notices.length,1);assert.match(notices[0].body,/MyDancr did not approve your main photo/);
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,2);
});
test('video rejection reuses the existing notification and says videos are optional',async()=>{
 await pg.exec(`insert into notifications(recipient_id,notification_type,payload) values('${id(1)}','tv_video_status','{"status":"rejected","videoId":"${id(7)}"}');`);
 const [notice]=await query("select * from notifications where notification_type='tv_video_status'");
 assert.match(notice.body,/Videos are optional/);assert.equal(notice.payload.emailPath,'/dashboard/dancer#dancer-videos-title');
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,2);
});
test('approved media and unrelated notifications do not enqueue rejection emails',async()=>{
 await pg.exec(`insert into image_moderation_records values('${id(8)}','${id(1)}','approved','profile_main');
 insert into notifications(recipient_id,notification_type,payload) values('${id(1)}','tv_video_status','{"status":"approved"}');`);
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,1);
});
test('claims are exclusive and a resolved club decision suppresses stale email',async()=>{
 const [job]=await query('select * from claim_dancer_media_emails()');
 assert.ok(job.lease_id);assert.equal((await query('select * from claim_dancer_media_emails()')).length,0);
 const [before]=await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]);
 assert.equal(before.target.email,'dancer@example.invalid');
 await pg.exec("update club_media_permissions set decision='approved'");
 const [after]=await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]);
 assert.equal(after.target,null);
});
test('unverified or inactive recipients cannot receive email; wrong lease cannot finish',async()=>{
 const [job]=await query('select * from claim_dancer_media_emails()');
 await pg.exec('update auth.users set email_confirmed_at=null');
 assert.equal((await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]))[0].target,null);
 await pg.exec("update auth.users set email_confirmed_at=now();update app_users set account_state='disabled'");
 assert.equal((await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]))[0].target,null);
 assert.equal((await query("select finish_dancer_media_email($1,$2,'accepted','provider_accepted') done",[job.id,id(99)]))[0].done,false);
});
test('retry keeps a durable receipt, backs off, and cannot be claimed early',async()=>{
 const [job]=await query('select * from claim_dancer_media_emails()');
 assert.equal((await query("select finish_dancer_media_email($1,$2,'retry','provider_unavailable') done",[job.id,job.lease_id]))[0].done,true);
 const [row]=await query('select * from dancer_media_email_deliveries');
 assert.equal(row.status,'pending');assert.equal(row.attempts,1);assert.equal(row.lease_id,null);
 assert.equal((await query('select * from claim_dancer_media_emails()')).length,0);
});
test('email queue and delivery RPCs are not exposed to browser roles',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal((await query(`select has_table_privilege('${role}','dancer_media_email_deliveries','SELECT') allowed`))[0].allowed,false);
  for(const fn of ['claim_dancer_media_emails()','dancer_media_email_target(uuid,uuid)','finish_dancer_media_email(uuid,uuid,text,text,text)'])
   assert.equal((await query(`select has_function_privilege('${role}','${fn}','EXECUTE') allowed`))[0].allowed,false);
 }
});
