import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {database,seed,notice,takeDown,eligible,restore,snapshot,id,schema} from './helpers/dmca-lifecycle-database.mjs';
import {operatorQuery} from './helpers/dmca-lifecycle-database.mjs';
let db;
before(async()=>{
 db=await database();
 for(const path of ['ownership.sql','takedown.sql','restoration.sql','admin-transition.sql'])await db.exec(readFileSync(new URL('./fixtures/dmca-lifecycle/'+path,import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections,'public.dmca_enforcement_states'].join(','));await seed(db);await notice(db);
});
const current=async()=> (await db.query('select status,updated_at::text from public.dmca_cases where id=$1',[id(200)])).rows[0];
async function transition(action,expected,overrides={}){
 const selected=expected||await current();
 const p={case:id(200),admin:id(2),action,status:selected.status,version:selected.updated_at,notes:'Synthetic administrator review',...overrides};
 return(await db.query('select public.transition_dmca_admin_case($1,$2,$3,$4,$5,$6)result',[p.case,p.admin,p.action,p.status,p.version,p.notes])).rows[0].result;
}
for(const [action,next]of [['request_information','needs_information'],['reject','rejected'],['record_court_action','court_hold'],['close','closed']]){
 for(const status of ['submitted','needs_information','disabled','countered','court_hold','restored','closed','rejected']){
  const allowed=action==='request_information'||action==='reject'?['submitted','needs_information'].includes(status):action==='record_court_action'?status==='countered':status==='court_hold';
  test(`${action} from ${status} ${allowed?'commits case and audit together':'is unavailable'}`,async()=>{
   await db.query('update public.dmca_cases set status=$1,court_filing_received=$2 where id=$3',[status,status==='court_hold',id(200)]);
   const before=await snapshot(db),selected=await current();
   if(!allowed){await assert.rejects(transition(action,selected),{code:'22023'});assert.deepEqual(await snapshot(db),before);return;}
   const receipt=await transition(action,selected),after=await snapshot(db);
   assert.equal(receipt.caseId,id(200));assert.equal(receipt.status,next);assert.equal(after.dmca_cases[0].status,next);
   assert.equal(after.admin_actions.length,before.admin_actions.length+1);
   assert.equal(after.admin_actions.at(-1).action,'dmca_'+action);
   assert.equal(after.admin_actions.at(-1).admin_id,id(2));
   assert.equal(after.dmca_cases[0].court_filing_received,action==='record_court_action'||status==='court_hold');
   assert.equal(Date.parse(receipt.updatedAt),Date.parse(after.dmca_cases[0].updated_at));
  });
 }
}
for(const overrides of [{admin:null},{admin:id(999)},{admin:id(1)},{case:null},{action:null},{action:'disable'},{status:null},{version:null},{version:'infinity'},{notes:'x'.repeat(4001)}]){
 test('invalid transition parameters do not change case or audit: '+Object.keys(overrides).join(','),async()=>{
  const before=await snapshot(db);await assert.rejects(transition('request_information',undefined,overrides));assert.deepEqual(await snapshot(db),before);
 });
}
test('disabled administrator cannot transition a case',async()=>{
 await operatorQuery(db,"update public.app_users set account_state='disabled' where id=$1",[id(2)]);const before=await snapshot(db);
 await assert.rejects(transition('request_information'),{code:'42501'});assert.deepEqual(await snapshot(db),before);
});
for(const changed of ["status='needs_information'","updated_at=updated_at+interval '1 second'"]){
 test('selected case version conflict is atomic: '+changed,async()=>{
  const selected=await current();await db.exec('update public.dmca_cases set '+changed);const before=await snapshot(db);
  await assert.rejects(transition('request_information',selected),{code:'40001'});assert.deepEqual(await snapshot(db),before);
 });
}
for(const table of ['dmca_cases','admin_actions'])for(const body of ["raise exception 'synthetic failure' using errcode='XX000';",'return null;',...(table==='dmca_cases'?["new.status:='submitted';return new;","new.reviewed_by:=null;return new;","new.updated_at:=new.updated_at+interval '1 second';return new;"]:[])]){
 test(`${table} ${body.startsWith('return')?'suppression':'failure'} rolls back both writes`,async()=>{
  const before=await snapshot(db);
  await db.exec(`reset role;create function public.synthetic_case_failure()returns trigger language plpgsql as $$begin ${body}end$$;
   create trigger synthetic_case_failure before ${table==='dmca_cases'?'update':'insert'} on public.${table} for each row execute function public.synthetic_case_failure();set role service_role`);
  try{await assert.rejects(transition('reject'));assert.deepEqual(await snapshot(db),before);}
  finally{await db.exec('reset role;drop trigger synthetic_case_failure on public.'+table+';drop function public.synthetic_case_failure();set role service_role');}
 });
}
for(const role of ['anon','authenticated']){
 test(role+' cannot invoke the administrator case writer',async()=>{
  const selected=await current();await db.exec('set role '+role);await assert.rejects(transition('reject',selected),{code:'42501'});
 });
}
test('a court hold committed first blocks subsequent restoration',async()=>{
 await takeDown(db);await eligible(db);await transition('record_court_action');const before=await snapshot(db);
 await assert.rejects(restore(db));assert.deepEqual(await snapshot(db),before);assert.equal(before.dmca_strikes[0].active,true);
});
test('restoration committed first rejects a stale court hold without falsely recording it',async()=>{
 await takeDown(db);await eligible(db);const selected=await current();await restore(db);const before=await snapshot(db);
 await assert.rejects(transition('record_court_action',selected),{code:'40001'});assert.deepEqual(await snapshot(db),before);
 assert.equal(before.dmca_cases[0].court_filing_received,false);
});
test('closing a court-held case retains the restriction and active strike',async()=>{
 await takeDown(db);await eligible(db);await transition('record_court_action');await transition('close');const after=await snapshot(db);
 assert.equal(after.dmca_cases[0].status,'closed');assert.equal(after.dmca_cases[0].court_filing_received,true);
 assert.equal(after.dmca_strikes[0].active,true);assert.equal(after.mydancr_tv_videos.find(v=>v.id===id(100)).status,'hidden');
});
test('court action requires nonempty review notes',async()=>{
 await takeDown(db);await eligible(db);const before=await snapshot(db);
 await assert.rejects(transition('record_court_action',undefined,{notes:'  '}),{code:'22023'});assert.deepEqual(await snapshot(db),before);
});
