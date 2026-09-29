import assert from 'node:assert/strict';
import test, {before, beforeEach, afterEach, after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createTapDatabase, seedTapDatabase, fixtureId as id} from './helpers/dancer-tap-database.mjs';

const migration = name => readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let pg;
before(async()=>{
 pg=await createTapDatabase(); await seedTapDatabase(pg); await pg.exec('reset role');
 await pg.exec("alter table public.venue_team_members add column role text default 'staff'; create table public.dancer_age_verifications(user_id uuid primary key,provider text,status text,verified_at timestamptz); grant all on public.dancer_age_verifications to service_role;");
 for(const name of ['20260928090000_mydancr_internal_channels.sql','20260928090100_mydancr_internal_roster.sql']) await pg.exec(migration(name));
 await pg.query("insert into public.dancer_age_verifications values($1,'ondato','verified',now()-interval '1 day'),($2,'ondato','verified',now()-interval '1 day')",[id(1),id(5)]);
});
beforeEach(async()=>pg.exec('begin;set role service_role'));
afterEach(async()=>pg.exec('rollback;reset role'));
after(async()=>pg?.close());
const tap = async(mode='internal', {user=id(1),tag=id(30),key=id(50)}={}) => (await pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5) result',[tag,user,key,mode,{}])).rows[0].result;
const roster = async(venue=id(20)) => (await pg.query('select * from public.internal_roster_members($1)',[venue])).rows;
const profile = async()=> (await pg.query('select is_public from public.dancer_profiles where id=$1',[id(10)])).rows[0];
const manage = async(action,data={},actor=id(2),venue=id(20)) => (await pg.query('select public.internal_roster_manage($1,$2,$3,$4) result',[actor,venue,action,data])).rows[0].result;
const link = async(kind='table')=>{const result=await manage('link_create',{kind,label:'Table 12'});return (await pg.query('select * from public.internal_roster_links where id=$1',[result.id])).rows[0];};
const request = async(token,dancer=id(10),key=id(80))=>(await pg.query('select public.internal_roster_request($1,$2,$3) result',[token,dancer,key])).rows[0].result;
async function rejectsAtomic(action,code){await pg.exec('savepoint rejected');await assert.rejects(action,{code});await pg.exec('rollback to rejected');}

for(const [mode,external,internal] of [['internal',false,true],['external',true,false],['both',true,true]]) test(mode+' populates only selected channels',async()=>{
 const result=await tap(mode); assert.equal(result.visibility,mode);assert.equal(result.replayed,false);assert.equal(result.shiftCheckedIn,true);
 assert.equal((await profile()).is_public,external);assert.equal((await roster()).length,internal?1:0);assert.equal((await roster(id(21))).length,0);
 if(internal)assert.deepEqual(Object.keys((await roster())[0]).sort(),['id','stage_name','avatar_storage_path','working_until'].sort());
});
test('fresh check-in requires an explicit valid selection and does not create partial consent',async()=>{
 for(const mode of [null,'','neither','all'])await rejectsAtomic(()=>tap(mode),'22023');
 assert.equal((await pg.query('select * from public.dancer_channel_preferences')).rows.length,0);
 assert.equal((await pg.query('select * from public.shifts')).rows.length,0);
});
test('all modes require a complete profile with approved gallery and canonical avatar',async()=>{
 await pg.query('delete from public.dancer_photos where dancer_id=$1',[id(10)]);
 for(const mode of ['internal','external','both'])await rejectsAtomic(()=>tap(mode),'42501');
 assert.equal((await pg.query('select * from public.dancer_channel_preferences')).rows.length,0);
});
test('Ondato verification must precede the tap for every mode',async()=>{
 await pg.query("update public.dancer_age_verifications set provider='veriff' where user_id=$1",[id(1)]);
 await rejectsAtomic(()=>tap(),'42501');
 await pg.query("update public.dancer_age_verifications set provider='ondato',verified_at=now()+interval '1 hour' where user_id=$1",[id(1)]);
 await rejectsAtomic(()=>tap(),'42501');
});
test('same-club visibility changes reuse the shift without extending it',async()=>{
 const first=await tap('internal');const second=await tap('both',{key:id(51)});assert.equal(second.shiftId,first.shiftId);assert.equal(second.workingUntil,first.workingUntil);assert.equal(second.alreadyWorking,true);assert.equal((await profile()).is_public,true);
 await tap('external',{key:id(52)});assert.equal((await roster()).length,0);
 await tap('internal',{key:id(53)});assert.equal((await roster()).length,1);assert.equal((await profile()).is_public,false);
});
test('an old response replay cannot overwrite a newer visibility choice',async()=>{
 await tap('internal');await tap('external',{key:id(51)});assert.equal((await tap('internal')).replayed,true);assert.equal((await profile()).is_public,true);assert.equal((await roster()).length,0);
 await rejectsAtomic(()=>tap('both'),'40001');
});
test('another club cannot steal an active shift or alter its visibility',async()=>{
 const first=await tap('internal');await rejectsAtomic(()=>tap('external',{tag:id(31),key:id(51)}),'40001');assert.equal((await profile()).is_public,false);assert.equal(new Date((await roster())[0].working_until).getTime(),new Date(first.workingUntil).getTime());
 assert.equal((await pg.query('select * from public.venue_dancer_affiliations where venue_id=$1',[id(21)])).rows.length,0);
});
test('cooldown rejects a new visibility choice atomically',async()=>{
 await tap('internal');await pg.query("update public.shifts set checked_out_at=clock_timestamp() where dancer_id=$1",[id(10)]);
 await rejectsAtomic(()=>tap('external',{key:id(51)}),'40001');assert.equal((await profile()).is_public,false);assert.equal((await roster()).length,0);
});
test('legacy publication actions cannot override internal-only discovery consent',async()=>{
 await tap('internal');await pg.query('update public.dancer_profiles set is_public=true where id=$1',[id(10)]);assert.equal((await profile()).is_public,false);
});
for(const [name,sql]of [
 ['shift expiry',"update public.shifts set checked_in_at=now()-interval '7 hours',last_location_verified_at=now()-interval '7 hours',location_verification_expires_at=now()-interval '1 hour'"],
 ['check out',"update public.shifts set checked_out_at=now()"],
 ['account suspension',"update public.app_users set account_state='disabled' where role='dancer'"],
 ['club suspension',"update public.venues set is_active=false"],
 ['affiliation revocation',"update public.venue_dancer_affiliations set status='revoked',revoked_at=now()"],
 ['age verification revocation',"update public.dancer_age_verifications set status='rejected'"],
])test(name+' removes internal roster access',async()=>{await tap();await pg.exec(sql);assert.equal((await roster()).length,0);});
test('canonical avatar updates are reflected without creating a second photo',async()=>{
 await tap();await pg.query("update public.dancer_profiles set avatar_storage_path='canonical/new-avatar' where id=$1",[id(10)]);assert.equal((await roster())[0].avatar_storage_path,'canonical/new-avatar');
});
test('table requests are idempotent and club-scoped',async()=>{
 await tap();const table=await link();const result=await request(table.token);assert.deepEqual(await request(table.token),result);
 await rejectsAtomic(()=>request(table.token,id(11)),'40001');
 await rejectsAtomic(()=>manage('request_status',{id:result.id,expectedStatus:'pending',status:'acknowledged'},id(6),id(21)),'P0002');
 await manage('request_status',{id:result.id,expectedStatus:'pending',status:'acknowledged'});
 await rejectsAtomic(()=>manage('request_status',{id:result.id,expectedStatus:'pending',status:'cancelled'}),'40001');
 await manage('request_status',{id:result.id,expectedStatus:'acknowledged',status:'completed'});
});
test('external-only dancers cannot be requested through internal table links',async()=>{await tap('external');const table=await link();await rejectsAtomic(()=>request(table.token),'40001');});
test('display links cannot submit table requests; revoked links stop working',async()=>{
 await tap();const display=await link('display');await rejectsAtomic(()=>request(display.token),'42501');const table=await link();await request(table.token);await manage('link_revoke',{id:table.id});await rejectsAtomic(()=>request(table.token),'42501');
 assert.equal((await pg.query('select status from public.internal_roster_requests')).rows[0].status,'cancelled');
});
test('staff can acknowledge requests but only managers can create links',async()=>{
 await pg.query('insert into public.venue_team_members(venue_id,user_id,status,role) values($1,$2,$3,$4)',[id(20),id(6),'active','staff']);
 await rejectsAtomic(()=>manage('link_create',{kind:'table',label:'Other'},id(6)),'42501');
 await tap();const table=await link();const r=await request(table.token);await manage('request_status',{id:r.id,expectedStatus:'pending',status:'acknowledged'},id(6));
});
test('browser roles cannot read operational data or call service-only RPCs',async()=>{
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);
  await rejectsAtomic(()=>pg.query('select * from public.dancer_channel_preferences'),'42501');
  await rejectsAtomic(()=>roster(),'42501');await rejectsAtomic(()=>tap(),'42501');
 }
});
