import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test,{before,after} from 'node:test';
import {createCashierDatabase,seedCashierDatabase,issueCashier,cashierId as id} from './helpers/cashier-allocation-database.mjs';
let pg,sequence=200,financialBefore;
const migration=readFileSync(new URL('../supabase/migrations/20260916040000_staff_verified_admission_passes.sql',import.meta.url),'utf8');
const financial=async()=>{const out={};for(const t of ['deal_revenue_events','commission_events','agent_commission_events','nats_commission_exports'])out[t]=(await pg.query(`select to_jsonb(t) row from ${t} t order by id`)).rows;return out;};
before(async()=>{
 pg=await createCashierDatabase();await seedCashierDatabase(pg,{enrolled:true});await issueCashier(pg,{number:30,source:'dancer_profile'});await pg.exec('reset role');
 financialBefore=await financial();
 await pg.exec("alter table venue_team_members add column role text;create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
 if(!(await pg.query("select to_regprocedure('public.confirm_deal_redemption(text,jsonb)') fn")).rows[0].fn)await pg.exec("create function confirm_deal_redemption(text,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$");
 for(const [n,role] of [[4,'venue'],[5,'customer'],[6,'venue'],[7,'venue'],[8,'venue']]){
  await pg.query('insert into auth.users values($1)',[id(n)]);await pg.query("insert into app_users values($1,$2,'active')",[id(n),role]);
 }
 await pg.exec("update venues set page_review_status='published',published_at=now();update club_deals set valid_days=null,valid_start_time=null,valid_end_time=null");
 await pg.query("insert into venues(id,owner_user_id,name,slug,city,is_active,timezone,page_review_status,published_at) values($1,$1,'Other venue','other-venue','Las Vegas',true,'America/Los_Angeles','published',now())",[id(4)]);
 for(const [n,role,status] of [[6,'staff','active'],[7,'manager','active'],[8,'staff','revoked']])await pg.query('insert into venue_team_members(user_id,venue_id,role,status) values($1,$2,$3,$4)',[id(n),id(1),role,status]);
 await pg.exec("create or replace function public.is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from app_users where id=auth.uid() and role='admin')$$;create or replace function public.is_current_venue_owner(venue_id uuid) returns boolean language sql stable security definer as $$select exists(select 1 from venues where id=venue_id and owner_user_id=auth.uid())$$;grant select on qr_redemptions to authenticated;alter table qr_redemptions enable row level security;create policy fixture_dancer_reads on qr_redemptions for select to authenticated using(dancer_id=auth.uid());");
 await pg.exec('grant execute on function public.is_admin(),public.is_current_venue_owner(uuid) to authenticated');
 await pg.exec(migration);
});
after(async()=>pg?.close());
async function as(n){await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await pg.exec('set role authenticated');}
async function issue({session=++sequence,customer=null,source='club_page',arrival='self_drive',deal=1}={}){
 await pg.exec('reset role;set role service_role');
 return(await pg.query('select issue_admission_pass($1,$2,$3,$4,$5,$6,$7,$8) r',[
  'a'.repeat(39)+String(++sequence).padStart(4,'0'),id(deal),id(session),customer?id(customer):null,source,source==='dancer_profile'?id(2):null,source==='dancer_profile'?id(2):null,arrival
 ])).rows[0].r;
}
async function redeem(token,actor=1,verified=true){await as(actor);return(await pg.query('select confirm_admission_pass($1,$2) r',[token,verified])).rows[0].r;}
test('claim is unredeemed, private, expiring, and repeated claims reuse the token',async()=>{
 const a=await issue({session:101}),b=await issue({session:101});assert.equal(a.token,b.token);
 await pg.exec('reset role');const r=(await pg.query('select * from qr_redemptions where redemption_token=$1',[a.token])).rows[0];
 assert.equal(r.status,'generated');assert.equal(r.nfc_tag_id,null);assert.equal(r.arrival_method,'self_drive');assert.equal(r.admission_pass_version,1);
 assert.equal(new Date(r.expires_at)-new Date(r.generated_at)<12*3600000+5000,true);
 await as(5);await assert.rejects(pg.query('select issue_admission_pass($1,$2,$3,null,$4,null,null,$5)',[a.token,id(1),id(101),'club_page','self_drive']),e=>e.code==='42501');
});
test('only current authorized venue owner, manager and staff can admit guests',async()=>{
 const p=await issue();for(const actor of [null,2,3,4,5,8])await assert.rejects(redeem(p.token,actor),e=>e.code==='42501');
 for(const actor of [1,6,7]){const next=await issue();const r=await redeem(next.token,actor);assert.equal(r.status,'redeemed');assert.equal(r.alreadyRedeemed,false);}
});
test('arrival verification is required and invalid ride methods cannot claim',async()=>{
 const p=await issue();await assert.rejects(redeem(p.token,1,false),e=>e.code==='22023');await assert.rejects(redeem(p.token,1,null),e=>e.code==='22023');
 await assert.rejects(issue({arrival:'rideshare_taxi'}),e=>e.code==='22023');
 for(const arrival of ['club_shuttle','autonomous_cab','waymo','zoox','cybercab'])assert.ok((await issue({arrival})).token);
});
test('repeat scans create one admission and one confirmation event',async()=>{
 const p=await issue();await as(6);
 const receipts=await Promise.all([1,2].map(()=>pg.query('select confirm_admission_pass($1,true) r',[p.token])));
 assert.deepEqual(receipts.map(x=>x.rows[0].r.alreadyRedeemed),[false,true]);
 await pg.exec('reset role');assert.equal((await pg.query("select count(*)::integer n from qr_redemption_events e join qr_redemptions r on r.id=e.qr_redemption_id where r.redemption_token=$1 and e.event_type='venue_confirmed'",[p.token])).rows[0].n,1);
});
test('selection changes void the unused pass; redeemed guests cannot claim another',async()=>{
 const old=await issue({session:110}),next=await issue({session:110,arrival:'autonomous_cab'});assert.notEqual(old.token,next.token);
 await assert.rejects(redeem(old.token),e=>e.code==='22023');await redeem(next.token);await assert.rejects(issue({session:110}),e=>e.code==='23505');
 const signed=await issue({customer:5});await redeem(signed.token);await assert.rejects(issue({customer:5}),e=>e.code==='23505');
});
test('disabled staff, inactive offers and outside-hours passes cannot be redeemed',async()=>{
 const p=await issue();await pg.exec('reset role');await pg.query("update app_users set account_state='suspended' where id=$1",[id(6)]);
 await assert.rejects(redeem(p.token,6),e=>e.code==='42501');await pg.exec('reset role');await pg.query("update app_users set account_state='active' where id=$1",[id(6)]);
 await pg.query('update club_deals set is_active=false where id=$1',[id(1)]);await assert.rejects(redeem(p.token),e=>e.code==='22023');
 await pg.exec('reset role');await pg.query("update club_deals set is_active=true,valid_days=array['invalid-day'] where id=$1",[id(1)]);await assert.rejects(redeem(p.token),e=>e.code==='22023');
 await pg.exec('reset role');await pg.query('update club_deals set valid_days=null where id=$1',[id(1)]);
});
test('expired passes are rejected and pass attribution/arrival cannot be rewritten',async()=>{
 const p=await issue({source:'dancer_profile'});await as(2);
 assert.equal((await pg.query('select redemption_token from qr_redemptions where redemption_token=$1',[p.token])).rows.length,0);
 await pg.exec('reset role');
 await assert.rejects(pg.query("update qr_redemptions set source_type='club_page' where redemption_token=$1",[p.token]),e=>e.code==='42501');
 // Seed an expired pass at insertion, without altering an issued pass.
 const expired='e'.repeat(43);await pg.query("insert into qr_redemptions(redemption_token,venue_id,club_deal_id,source_type,session_id,expires_at,admission_pass_version,arrival_method) values($1,$2,$2,'club_page',$3,now()-interval '1 minute',1,'self_drive')",[expired,id(1),id(999)]);
 await assert.rejects(redeem(expired),e=>e.code==='22023');await redeem(p.token);await pg.exec('reset role');
 await assert.rejects(pg.query("update qr_redemptions set status='generated' where redemption_token=$1",[p.token]),e=>e.code==='42501');
});

test('offer hours use venue local time and overnight windows use their opening day',async()=>{
 // Pick a timezone that is just after local midnight, regardless of test time.
 await pg.exec('reset role');
 await pg.exec("update venues set timezone=case when extract(hour from now() at time zone 'UTC')::int<=12 then 'Etc/GMT+'||extract(hour from now() at time zone 'UTC')::int else 'Etc/GMT-'||(24-extract(hour from now() at time zone 'UTC')::int) end where id='"+id(1)+"'");
 const p=await issue();await pg.exec('reset role');
 await pg.exec("update club_deals set valid_start_time='20:00',valid_end_time='23:00'");
 await assert.rejects(redeem(p.token),e=>e.code==='22023'&&e.message.includes('hours'));
 await pg.exec('reset role');await pg.exec("update club_deals set valid_start_time='20:00',valid_end_time='04:00',valid_days=array[(select to_char((now() at time zone timezone)::date-1,'Dy') from venues where id='"+id(1)+"')]");
 assert.equal((await redeem(p.token)).status,'redeemed');
 await pg.exec('reset role');await pg.exec("update club_deals set valid_start_time='20:00',valid_end_time='20:00',valid_days=null");
 assert.equal((await redeem((await issue()).token)).status,'redeemed');
 await pg.exec('reset role');await pg.exec("update club_deals set valid_start_time=null,valid_end_time=null;update venues set timezone='America/Los_Angeles'");
});
test('authorized analytics separates claims and arrivals and rejects cross-venue requests',async()=>{
 await as(6);const r=(await pg.query("select get_venue_admission_metrics($1,now()-interval '1 day',now()+interval '1 second') r",[id(1)])).rows[0].r;
 assert.ok(r.claims>r.cohortRedemptions);assert.ok(r.redemptions>0);assert.ok(r.cohortRedemptions<=r.claims);
 await assert.rejects(pg.query("select get_venue_admission_metrics($1,now()-interval '1 day',now())",[id(4)]),e=>e.code==='42501');
});
test('new admissions preserve historical money records and retire cashier charge paths',async()=>{
 await pg.exec('reset role');assert.deepEqual(await financial(),financialBefore);
 for(const signature of ['confirm_deal_redemption(text,jsonb)','confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb)','issue_and_confirm_deal_redemption_from_nfc(text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz,jsonb)'])assert.equal((await pg.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
});
