import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

let pg;
const migration='supabase/migrations/20261028222538_restore_rhino_sample_roster.sql';
before(async()=>{
 pg=await createInternalRosterDatabase();
 await pg.exec(`create schema private;alter table auth.users add column email text,add column raw_user_meta_data jsonb,add column raw_app_meta_data jsonb,add column banned_until timestamptz,add column deleted_at timestamptz;
 create table dancer_age_verification_settings(singleton boolean primary key,enabled boolean);insert into dancer_age_verification_settings values(true,true);
 grant usage on schema private to service_role;
 update venues set slug='spearmint-rhino' where id='${id(20)}';
 update dancer_profiles set slug='echo-grid-001' where id='${id(10)}';
 update auth.users set email='echo-grid-001@synthetic.mydancr.invalid',banned_until=now()+interval '100 years',raw_app_meta_data=jsonb_build_object('dataset_marker','mydancr-rhino-restored-20261028','demo_venue_id','${id(20)}','demo_profile_id','${id(10)}') where id='${id(1)}';`);
 await pg.exec(readFileSync(migration,'utf8'));
 await pg.exec(`create table dancer_media_batches(dancer_id uuid,state text);
 create table private.sample_media_fixture(media jsonb);
 create function public.club_approved_media(uuid,uuid[]) returns jsonb language sql as $$select coalesce((select media from private.sample_media_fixture),'[]'::jsonb)$$;`);
 await pg.exec(readFileSync('supabase/migrations/20261029220855_expand_rhino_sample_roster.sql','utf8'));
 await pg.exec(`create trigger sample_batch_guard before update of status on dancer_profiles for each row execute function private.require_initial_media_batch();`);
 await pg.exec(`create table private.email_spy(kind text);
 create function private.emit_venue_email_event(uuid,text,text,text,text,text,boolean) returns void language sql as $$insert into private.email_spy values($3)$$;
 create trigger sample_roster_email after insert on venue_dancer_affiliations for each row execute function private.venue_operational_email_event();`);
 await pg.exec(`create trigger sample_age_guard before update on dancer_profiles for each row execute function enforce_dancer_age_verification();
 delete from dancer_age_verifications where user_id='${id(1)}';`);
});
beforeEach(()=>pg.exec('begin'));
afterEach(()=>pg.exec('rollback'));
after(()=>pg?.close());
const sample=async()=> (await pg.query('select private.is_restored_rhino_sample($1) ok',[id(1)])).rows[0].ok;
test('server-marked banned sample can be displayed without changing real age settings',async()=>{
 assert.equal(await sample(),true);
 await pg.exec(`update dancer_profiles set status='approved',verification_status='approved',is_public=true where id='${id(10)}'`);
 assert.equal((await pg.query('select enabled from dancer_age_verification_settings')).rows[0].enabled,true);
 assert.equal((await pg.query(`select count(*)::int n from dancer_age_verifications where user_id='${id(1)}'`)).rows[0].n,0);
});
for(const change of [
 "banned_until=null", "email='real@example.invalid'", "deleted_at=now()",
 "raw_app_meta_data='{}'::jsonb", `raw_app_meta_data=jsonb_set(raw_app_meta_data,'{demo_venue_id}','\"${id(21)}\"')`,
 `raw_app_meta_data=jsonb_set(raw_app_meta_data,'{demo_profile_id}','\"${id(11)}\"')`,
])test('sample exception fails closed: '+change,async()=>{
 await pg.exec(`update auth.users set ${change} where id='${id(1)}'`);assert.equal(await sample(),false);
 await assert.rejects(()=>pg.exec(`update dancer_profiles set status='approved',is_public=true where id='${id(10)}'`),{code:'42501'});
});
test('client metadata cannot opt into samples',async()=>{
 await pg.exec(`update auth.users set raw_user_meta_data=raw_app_meta_data,raw_app_meta_data='{}' where id='${id(1)}'`);
 assert.equal(await sample(),false);
});
test('sample restoration does not email the club; ordinary roster changes still do',async()=>{
 await pg.exec(`insert into venue_dancer_affiliations(venue_id,dancer_id) values('${id(20)}','${id(10)}')`);
 assert.equal((await pg.query('select count(*)::int n from private.email_spy')).rows[0].n,0);
 await pg.exec(`insert into venue_dancer_affiliations(venue_id,dancer_id) values('${id(20)}','${id(11)}')`);
 assert.equal((await pg.query('select count(*)::int n from private.email_spy')).rows[0].n,1);
});
test('registered sample shift is allowed only at its assigned venue and with explicit demo metadata',async()=>{
 await pg.exec(`update dancer_profiles set status='approved',verification_status='approved',is_public=true where id='${id(10)}';
 insert into shifts(id,dancer_id,venue_id,starts_at,ends_at,status,shift_source,shift_summary) values('${id(70)}','${id(10)}','${id(20)}',now(),now()+interval '1 day','posted','demo_locked','{"managedBy":"mydancr-rhino-restored-20261028","demoLocked":true,"internalDemoRoster":true}');`);
 const allowed=async()=> (await pg.query('select is_internal_demo_shift($1) ok',[id(70)])).rows[0].ok;
 assert.equal(await allowed(),true);
 await pg.exec(`update shifts set venue_id='${id(21)}' where id='${id(70)}'`);assert.equal(await allowed(),false);
 await pg.exec(`update shifts set venue_id='${id(20)}',shift_source='nfc_presence' where id='${id(70)}'`);assert.equal(await allowed(),false);
});
for(const role of ['anon','authenticated','service_role'])test(role+' cannot invoke the sample eligibility helper',async()=>{
 assert.equal((await pg.query(`select has_function_privilege('${role}','private.is_restored_rhino_sample(uuid)','execute') ok`)).rows[0].ok,false);
});

test('30th sample is included but 31st is excluded',async()=>{
 await pg.exec(`update dancer_profiles set slug='echo-grid-030' where id='${id(10)}';update auth.users set email='echo-grid-030@synthetic.mydancr.invalid' where id='${id(1)}'`);
 assert.equal(await sample(),true);
 await pg.exec(`update dancer_profiles set slug='echo-grid-031' where id='${id(10)}';update auth.users set email='echo-grid-031@synthetic.mydancr.invalid' where id='${id(1)}'`);
 assert.equal(await sample(),false);
});
for(const role of ['anon','authenticated'])test(role+' cannot read the server-only sample venue',async()=>{
 assert.equal((await pg.query(`select has_function_privilege('${role}','private.restored_rhino_sample_venue(uuid)','execute') ok`)).rows[0].ok,false);
});
test('service role can resolve sample venue without reading Auth',async()=>{
 await pg.exec('set local role service_role');
 assert.equal((await pg.query('select private.restored_rhino_sample_venue($1) venue',[id(10)])).rows[0].venue,id(20));
});
test('ordinary verified dancer still requires a completed media batch',async()=>{
 await pg.exec(`update auth.users set raw_app_meta_data='{}' where id='${id(1)}';insert into dancer_age_verifications(user_id,provider,status) values('${id(1)}','ondato','verified');`);
 await assert.rejects(()=>pg.exec(`update dancer_profiles set status='approved' where id='${id(10)}'`),{code:'42501'});
});
test('archived photo is displayed only for a marked sample at its assigned club',async()=>{
 const media=[{dancerId:id(10),photoId:id(100),isMain:true}];
 await pg.query('insert into private.sample_media_fixture values($1)',[JSON.stringify(media)]);
 const eligible=async venue=>(await pg.query('select eligible from private.club_media_eligibility($1,$2)',[venue,[id(10)]])).rows[0].eligible;
 assert.equal(await eligible(id(20)),true);
 assert.equal(await eligible(id(21)),false);
 await pg.exec(`update auth.users set banned_until=null where id='${id(1)}'`);
 assert.equal(await eligible(id(20)),false);
 media.push({dancerId:id(10),photoId:id(101)},{dancerId:id(10),photoId:id(102)},{dancerId:id(10),videoId:id(103)});
 await pg.query('update private.sample_media_fixture set media=$1',[JSON.stringify(media)]);
 assert.equal(await eligible(id(20)),true);
});
test('samples still require an approved main photo',async()=>{
 await pg.query('insert into private.sample_media_fixture values($1)',[JSON.stringify([{dancerId:id(10),photoId:id(100),isMain:false}])]);
 assert.equal((await pg.query('select eligible from private.club_media_eligibility($1,$2)',[id(20),[id(10)]])).rows[0].eligible,false);
});
