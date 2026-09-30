import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createCashierDatabase,seedCashierDatabase,cashierId as id} from './helpers/cashier-allocation-database.mjs';
const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let pg;
before(async()=>{
 pg=await createCashierDatabase();await seedCashierDatabase(pg);await pg.exec('reset role');
 await pg.exec("alter table venue_team_members add column role text;create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create or replace function public.is_admin() returns boolean language sql as $$select false$$;create or replace function public.is_current_venue_owner(venue_id uuid) returns boolean language sql as $$select false$$;");
 if(!(await pg.query("select to_regprocedure('public.confirm_deal_redemption(text,jsonb)') fn")).rows[0].fn)await pg.exec("create function confirm_deal_redemption(text,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$");
 await pg.exec("update venues set page_review_status='published',published_at=now();update club_deals set valid_days=null,valid_start_time=null,valid_end_time=null");
 await pg.exec(read('20260916040000_staff_verified_admission_passes.sql'));
 await pg.exec(read('20260916050000_allow_passes_for_published_unclaimed_venues.sql'));
 const video=read('20260916190000_venue_subscription_analytics.sql');
 await pg.exec(video.slice(video.indexOf('create function public.issue_video_admission_pass'),video.indexOf('-- Raw browser identifiers')));
 await pg.exec(read('20260930090000_free_entry_guest_list.sql'));
});
after(async()=>pg?.close());
async function issue(session,overrides={}){
 await pg.exec('reset role;set role service_role');
 const args={name:'Test Guest',phone:'+17025550123',email:null,consent:true,...overrides};
 return(await pg.query('select public.issue_guest_list_admission_pass($1,$2,$3,null,$4,null,null,$5,null,$6,$7,$8,$9) receipt',[
  String(session).padStart(43,'a'),id(1),id(session),'club_page','self_drive',args.name,args.phone,args.email,args.consent,
 ])).rows[0].receipt;
}
test('guest details and admission commit together and concurrent retries reuse one entry',async()=>{
 const [a,b]=await Promise.all([issue(700),issue(700)]);assert.equal(a.token,b.token);assert.equal(a.guestListJoined,true);
 await pg.exec('reset role');
 const entries=(await pg.query('select g.*,r.status from venue_guest_list_entries g join qr_redemptions r on r.id=g.pass_id where r.session_id=$1',[id(700)])).rows;
 assert.equal(entries.length,1);assert.equal(entries[0].venue_id,id(1));assert.equal(entries[0].guest_name,'Test Guest');assert.equal(entries[0].status,'generated');
 await assert.rejects(issue(700,{name:'Different guest'}),e=>e.code==='22023');
 await pg.exec('reset role');assert.equal((await pg.query('select guest_name from venue_guest_list_entries where pass_id=$1',[entries[0].pass_id])).rows[0].guest_name,'Test Guest');
});
test('invalid guest details never leave an issued pass behind',async()=>{
 for(const override of [{name:' '},{phone:'bad'},{consent:false},{email:'invalid'}])await assert.rejects(issue(701,override),e=>e.code==='22023');
 await pg.exec('reset role');assert.equal((await pg.query('select count(*)::int count from qr_redemptions where session_id=$1',[id(701)])).rows[0].count,0);
});
test('joining separately reuses the free-entry pass without extending its expiry or creating another admission',async()=>{
 await pg.exec('reset role;set role service_role');
 const original=(await pg.query('select public.issue_video_admission_pass($1,$2,$3,null,$4,null,null,$5,null) receipt',[
  'b'.repeat(43),id(1),id(705),'club_page','self_drive',
 ])).rows[0].receipt;
 await pg.exec('reset role');
 assert.equal((await pg.query('select count(*)::int count from venue_guest_list_entries g join qr_redemptions r on r.id=g.pass_id where r.session_id=$1',[id(705)])).rows[0].count,0);
 const joined=await issue(705);
 assert.equal(joined.token,original.token);assert.equal(joined.expiresAt,original.expiresAt);assert.equal(joined.guestListJoined,true);
 await pg.exec('reset role');
 const rows=(await pg.query('select r.id,g.guest_name from qr_redemptions r left join venue_guest_list_entries g on g.pass_id=r.id where r.session_id=$1',[id(705)])).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].guest_name,'Test Guest');
});
test('contact insert failure rolls admission issuance back',async()=>{
 await pg.exec("reset role;create function fail_guest_insert() returns trigger language plpgsql as $$begin raise exception 'Synthetic failure';end$$;create trigger fail_guest_insert before insert on venue_guest_list_entries for each row execute function fail_guest_insert();");
 try{await assert.rejects(issue(702));await pg.exec('reset role');assert.equal((await pg.query('select count(*)::int count from qr_redemptions where session_id=$1',[id(702)])).rows[0].count,0);}
 finally{await pg.exec('reset role;drop trigger fail_guest_insert on venue_guest_list_entries;drop function fail_guest_insert()');}
});
test('guest contacts and registration RPC are inaccessible to public database callers',async()=>{
 for(const role of ['anon','authenticated']){
  await pg.exec('reset role;set role '+role);
  await assert.rejects(pg.query('select * from venue_guest_list_entries'),e=>e.code==='42501');
  await assert.rejects(pg.query("select public.issue_guest_list_admission_pass(null,null,null,null,null,null,null,null,null,null,null,null,true)"),e=>e.code==='42501');
 }
});
