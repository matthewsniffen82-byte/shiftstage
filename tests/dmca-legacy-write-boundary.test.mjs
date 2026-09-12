import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {database,seed,notice,takeDown,eligible,restore,snapshot,id,schema} from './helpers/dmca-case-callers-database.mjs';
import {installRetiredClaimFixture,retiredClaimTables,seedRetiredClaimHistory} from './helpers/dmca-retired-claim-fixture.mjs';
import {legacySource as sql} from './helpers/dmca-legacy-deployment.mjs';
const retired=JSON.parse(readFileSync(new URL('./fixtures/dmca-retired-claim-function.json',import.meta.url),'utf8'));
const details={legalName:'Synthetic dancer',email:'dancer@example.invalid',phone:'5555555555',address:'123 Synthetic street',removedMaterialLocation:'https://example.invalid/synthetic',signature:'Synthetic dancer',mistakeBeliefConfirmed:true,perjuryConfirmed:true,jurisdictionConfirmed:true,serviceConfirmed:true};
let db;
before(async()=>{
 db=await database();
 await installRetiredClaimFixture(db);
 assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',['public.'+retired.signature])).rows[0].hash,retired.fingerprint);
 assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute')allowed",['public.'+retired.signature])).rows[0].allowed,true);
 await db.exec(sql);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections,...retiredClaimTables].join(','));await seed(db);await notice(db);await seedRetiredClaimHistory(db);});
for(const role of ['anon','authenticated','service_role'])for(const table of ['dmca_cases','dmca_counter_notices','dmca_strikes'])for(const action of ['insert','update','delete']){
 if(role==='service_role'&&table==='dmca_cases'&&action==='insert')continue;
 test(role+' direct '+action+' on '+table+' is denied even for an administrator identity',async()=>{
  const before=await snapshot(db);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);await db.exec('set role '+role);
  const query=action==='insert'?'insert into public.'+table+'(id)values($1)':action==='update'?'update public.'+table+' set id=id where id=$1':'delete from public.'+table+' where id=$1';
  await assert.rejects(db.query(query,[id(200)]),error=>error.code==='42501'&&/permission denied/.test(error.message));await db.exec('reset role');assert.deepEqual(await snapshot(db),before);
 });
}
test('trusted service can still submit a new claimant notice',async()=>{
 await notice(db,201,101);assert.equal((await snapshot(db)).dmca_cases.length,2);
});
test('trusted service can complete takedown, counter submission and forwarding through the native writers',async()=>{
 assert.equal((await takeDown(db)).activeStrikes,1);
 const submitted=(await db.query('select public.submit_dmca_counter_notice_safely($1,$2,$3)result',[id(1),id(200),JSON.stringify(details)])).rows[0].result;
 const forwarded=(await db.query('select public.confirm_dmca_counter_forwarding($1,$2)result',[submitted.counter.id,id(200)])).rows[0].result;assert.equal(forwarded.status,'forwarded');
});
test('administrator case and audit transition remains atomic through its native writer',async()=>{
 const version=(await db.query('select to_jsonb(updated_at)value from public.dmca_cases where id=$1',[id(200)])).rows[0].value;
 const result=(await db.query('select public.transition_dmca_admin_case($1,$2,$3,$4,$5,$6)result',[id(200),id(2),'reject','submitted',version,'Synthetic review'])).rows[0].result;assert.equal(result.status,'rejected');assert.equal((await snapshot(db)).admin_actions[0].action,'dmca_reject');
});
test('restoration remains allowed through its verified service-only transaction',async()=>{
 await takeDown(db);await db.exec('reset role');await eligible(db);await db.exec('set role service_role');assert.equal((await restore(db)).status,'restored');assert.equal((await snapshot(db)).dmca_strikes[0].active,false);
});
for(const role of ['anon','authenticated','service_role'])test(role+' cannot invoke the retired venue-ownership writer',async()=>{
 await db.exec('set role '+role);await assert.rejects(db.query('select public.review_venue_ownership_claim($1,$2,$3,$4)',[id(200),id(2),'approved','Synthetic review']),error=>error.code==='42501'&&/permission denied for function review_venue_ownership_claim/.test(error.message));
});
test('retirement preserves the existing function body, owner and administrator history',async()=>{
 assert.equal((await db.query('select status from public.venue_ownership_claims where id=$1',[id(250)])).rows[0].status,'rejected');
 await db.exec('reset role');const row=(await db.query('select md5(pg_get_functiondef(oid))hash,pg_get_userbyid(proowner)owner,prosecdef,proacl::text acl from pg_proc where oid=$1::regprocedure',['public.'+retired.signature])).rows[0];assert.deepEqual(row,{hash:retired.fingerprint,owner:'postgres',prosecdef:true,acl:'{postgres=X/postgres}'});assert.equal((await db.query("select has_function_privilege('postgres',$1,'execute')allowed",['public.'+retired.signature])).rows[0].allowed,true);
});
test('explicit column write grants cannot bypass the cutover and read grants are preserved',async()=>{
 await db.exec('reset role;begin;grant insert(status),update(status)on public.dmca_counter_notices to anon,authenticated,service_role;grant select(status)on public.dmca_counter_notices to service_role');
 try{
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_column_privilege($1,'public.dmca_counter_notices','status','UPDATE')allowed",[role])).rows[0].allowed,true);
  await db.exec(sql);
  for(const role of ['anon','authenticated','service_role'])for(const right of ['INSERT','UPDATE'])assert.equal((await db.query("select has_column_privilege($1,'public.dmca_counter_notices','status',$2)allowed",[role,right])).rows[0].allowed,false);
  assert.equal((await db.query("select has_column_privilege('service_role','public.dmca_counter_notices','status','SELECT')allowed")).rows[0].allowed,true);
 }finally{await db.exec('rollback;set role service_role');}
});
