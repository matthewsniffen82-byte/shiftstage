import assert from 'node:assert/strict';
import test, {before,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createTapDatabase,seedTapDatabase,fixtureId as id} from './helpers/dancer-tap-database.mjs';
let pg;
before(async()=>{
  pg=await createTapDatabase(); await seedTapDatabase(pg); await pg.exec('reset role');
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261012033238_dancer_onboarding_three_photos.sql',import.meta.url),'utf8'));
  await pg.exec('set role service_role');
});
after(async()=>pg?.close());
const register=async()=>(await pg.query("select register_dancer_nfc_enrollment($1,$2,$3,'{}') result",[id(30),id(1),id(50)])).rows[0].result;
test('early tap remains saved and pending with fewer than three photos',async()=>{
  const result=await register(); assert.equal(result.enrollmentStatus,'pending');
  assert.equal((await pg.query('select status from dancer_profiles where id=$1',[id(10)])).rows[0].status,'pending_review');
  assert.equal((await pg.query('select count(*) n from venue_dancer_affiliations')).rows[0].n,0);
});
test('a pending tap can activate after three photos pass, despite an optional pending photo',async()=>{
  for(const [n,status]of [[201,'approved'],[202,'approved'],[203,'pending']])await pg.query('insert into dancer_photos(id,dancer_id,storage_path,review_status,sort_order) values($1,$2,$3,$4,$5)',[id(n),id(10),'synthetic/'+n,status,n]);
  const result=await register(); assert.equal(result.enrollmentStatus,'completed'); assert.equal(result.profileActivated,true);
  assert.equal((await pg.query('select status from dancer_profiles where id=$1',[id(10)])).rows[0].status,'approved');
});
test('activation functions keep their private service-role permissions',async()=>{
  for(const fn of ['register_dancer_nfc_enrollment','approve_dancer_venue_affiliation_from_nfc']) {
    const sig=fn+'(uuid,uuid,uuid,jsonb)';
    for(const role of ['anon','authenticated'])assert.equal((await pg.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,sig])).rows[0].allowed,false);
    assert.equal((await pg.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed",[sig])).rows[0].allowed,true);
  }
});
