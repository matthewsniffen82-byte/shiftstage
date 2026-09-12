import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {database,seed,notice,takeDown,snapshot,id,schema} from './helpers/dmca-lifecycle-database.mjs';
import {operatorQuery} from './helpers/dmca-lifecycle-database.mjs';
let db;
const details={legalName:'Synthetic dancer',email:'dancer@example.invalid',phone:'5555555555',address:'123 Synthetic street',removedMaterialLocation:'https://example.invalid/synthetic',signature:'Synthetic dancer',mistakeBeliefConfirmed:true,perjuryConfirmed:true,jurisdictionConfirmed:true,serviceConfirmed:true};
before(async()=>{
 db=await database();
 for(const file of ['ownership.sql','takedown.sql','restoration.sql','admin-transition.sql','counter-submission.sql','counter-forwarding.sql'])await db.exec(readFileSync(new URL('./fixtures/dmca-lifecycle/'+file,import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections,'public.dmca_enforcement_states'].join(','));
 await seed(db);await notice(db);await takeDown(db);
});
const submit=async(overrides={})=>(await db.query('select public.submit_dmca_counter_notice_safely($1,$2,$3)result',[overrides.user??id(1),overrides.case??id(200),JSON.stringify(overrides.details??details)])).rows[0].result;
const forward=async(counter,caseId=id(200))=>(await db.query('select public.confirm_dmca_counter_forwarding($1,$2)result',[counter,caseId])).rows[0].result;
async function fault(table,event,body,run){
 await db.exec(`reset role;create function public.synthetic_counter_failure()returns trigger language plpgsql as $$begin ${body}end$$;create trigger synthetic_counter_failure before ${event} on public.${table} for each row execute function public.synthetic_counter_failure();set role service_role`);
 try{await run();}finally{await db.exec(`reset role;drop trigger synthetic_counter_failure on public.${table};drop function public.synthetic_counter_failure();set role service_role`);}
}
test('submission atomically creates its legal receipt and case waiting period without mail acknowledgement',async()=>{
 const before=await snapshot(db),result=await submit(),after=await snapshot(db);
 assert.equal(result.duplicate,false);assert.equal(result.case.status,'countered');assert.equal(result.counter.status,'submitted');
 assert.equal(after.dmca_counter_notices.length,1);assert.equal(after.dmca_counter_notices[0].forwarded_to_claimant_at,null);
 assert.ok(Date.parse(result.case.restore_eligible_at)>Date.parse(result.case.counter_received_at));
 assert.ok(Date.parse(result.case.restore_deadline_at)>Date.parse(result.case.restore_eligible_at));
 for(const table of schema.scope.fullTargets.filter(t=>!['dmca_cases','dmca_counter_notices'].includes(t)))assert.deepEqual(after[table],before[table],table);
});
test('same submission returns original receipt with no timestamp rewrites',async()=>{
 const first=await submit(),before=await snapshot(db),second=await submit();
 assert.deepEqual(second,{...first,duplicate:true});assert.deepEqual(await snapshot(db),before);
});
test('uploader whose login account is disabled can still submit a counter-notice through the trusted service',async()=>{
 await operatorQuery(db,"update public.app_users set account_state='disabled' where id=$1",[id(1)]);assert.equal((await submit()).case.status,'countered');
});
for(const role of ['anon','authenticated'])for(const action of ['submit','forward'])test(role+' cannot invoke '+action+' with a forged uploader identity',async()=>{
 const counter=(await submit()).counter.id;const before=await snapshot(db);await db.exec('set role '+role);
 await assert.rejects(action==='submit'?submit():forward(counter),{code:'42501'});await db.exec('reset role');assert.deepEqual(await snapshot(db),before);
});
for(const input of [{user:id(3)},{case:id(999)},{details:{...details,perjuryConfirmed:false}},{details:{...details,email:'invalid'}}])test('invalid counter parameters preserve state: '+JSON.stringify(input),async()=>{
 const before=await snapshot(db);await assert.rejects(submit(input));assert.deepEqual(await snapshot(db),before);
});
test('changed legal details cannot replace an existing signed submission',async()=>{
 await submit();const before=await snapshot(db);await assert.rejects(submit({details:{...details,signature:'Different signer'}}),{code:'23505'});assert.deepEqual(await snapshot(db),before);
});
for(const [table,event,body]of [
 ['dmca_counter_notices','insert','return null;'],
 ['dmca_counter_notices','insert',"new.status:='completed';return new;"],
 ['dmca_counter_notices','insert',"new.signature:='Changed signer';return new;"],
 ['dmca_counter_notices','insert',"raise exception 'synthetic failure' using errcode='XX000';"],
 ['dmca_cases','update','return null;'],
 ['dmca_cases','update',"new.status:='disabled';return new;"],
 ['dmca_cases','update',"new.restore_eligible_at:=new.restore_eligible_at+interval '1 day';return new;"],
 ['dmca_cases','update',"raise exception 'synthetic failure' using errcode='XX000';"]
])test('submission rollback after '+table+' '+body,async()=>{
 const before=await snapshot(db);await fault(table,event,body,async()=>{await assert.rejects(submit(),{code:body.startsWith('raise')?'XX000':'40001'});assert.deepEqual(await snapshot(db),before);});
});
for(const status of ['countered','court_hold','closed'])test('acknowledged delivery is recorded without rewinding '+status+' case',async()=>{
 const counter=(await submit()).counter.id;await db.query('update public.dmca_cases set status=$1,court_filing_received=$2 where id=$3',[status,status!=='countered',id(200)]);
 const before=await snapshot(db),result=await forward(counter),after=await snapshot(db);
 assert.equal(result.id,counter);assert.equal(result.case_id,id(200));assert.equal(result.status,'forwarded');assert.ok(Number.isFinite(Date.parse(result.forwarded_to_claimant_at)));
 assert.deepEqual(after.dmca_cases,before.dmca_cases);assert.equal(after.dmca_counter_notices[0].status,'forwarded');
 for(const table of schema.scope.fullTargets.filter(t=>t!=='dmca_counter_notices'))assert.deepEqual(after[table],before[table],table);
});
for(const status of ['submitted','needs_information','disabled','rejected','restored'])test('late acknowledgment rejects inconsistent '+status+' case without changing either row',async()=>{
 const counter=(await submit()).counter.id;await db.query('update public.dmca_cases set status=$1 where id=$2',[status,id(200)]);const before=await snapshot(db);
 await assert.rejects(forward(counter),{code:'40001'});assert.deepEqual(await snapshot(db),before);
});
for(const status of ['forwarded','completed'])test('repeat acknowledgement retains original '+status+' receipt',async()=>{
 const counter=(await submit()).counter.id,first=await forward(counter);await db.query('update public.dmca_counter_notices set status=$1 where id=$2',[status,counter]);
 const before=await snapshot(db),again=await forward(counter);assert.deepEqual(again,{...first,status});assert.deepEqual(await snapshot(db),before);
});
for(const [counterStatus,date]of [['rejected',null],['withdrawn',null],['forwarded',null],['forwarded','infinity'],['forwarded','2099-01-01Z'],['submitted','2026-01-01Z']])test('inconsistent forwarding state is not manufactured: '+counterStatus+' '+date,async()=>{
 const counter=(await submit()).counter.id;await db.query('update public.dmca_counter_notices set status=$1,forwarded_to_claimant_at=$2 where id=$3',[counterStatus,date,counter]);
 const before=await snapshot(db);await assert.rejects(forward(counter),{code:'40001'});assert.deepEqual(await snapshot(db),before);
});
for(const [counter,caseId]of [[null,id(200)],[id(999),id(200)],[id(999),id(999)],[id(999),null]])test('unknown forwarding identity cannot write: '+counter+' '+caseId,async()=>{
 await submit();const before=await snapshot(db);await assert.rejects(forward(counter,caseId));assert.deepEqual(await snapshot(db),before);
});
test('counter uploader changed independently is rejected',async()=>{
 const counter=(await submit()).counter.id;await db.query('update public.dmca_counter_notices set uploader_id=$1 where id=$2',[id(3),counter]);const before=await snapshot(db);
 await assert.rejects(forward(counter),{code:'40001'});assert.deepEqual(await snapshot(db),before);
});
for(const body of ['return null;',"new.status:='submitted';return new;","new.forwarded_to_claimant_at:=null;return new;","new.uploader_id:='"+id(3)+"';return new;","raise exception 'synthetic failure' using errcode='XX000';"])test('forwarding write failure preserves existing case and receipt: '+body,async()=>{
 const counter=(await submit()).counter.id,before=await snapshot(db);
 await fault('dmca_counter_notices','update',body,async()=>{await assert.rejects(forward(counter),{code:body.startsWith('raise')?'XX000':'40001'});assert.deepEqual(await snapshot(db),before);});
});
test('new protected functions still work after a rehearsal revokes direct service writes',async()=>{
 await db.exec('reset role;begin;revoke insert,update,delete on public.dmca_cases,public.dmca_counter_notices,public.dmca_strikes from public,anon,authenticated,service_role;set role service_role');
 try{
  await assert.rejects(db.query("update public.dmca_cases set status='rejected' where id=$1",[id(200)]),{code:'42501'});
 }finally{await db.exec('rollback;reset role');}
 // Permission errors abort an explicit PostgreSQL transaction. Rehearse the
 // permitted RPCs separately, so the expected denial cannot mask their result.
 await db.exec('begin;revoke insert,update,delete on public.dmca_cases,public.dmca_counter_notices,public.dmca_strikes from public,anon,authenticated,service_role;set role service_role');
 try{
  const submitted=await submit(),receipt=await forward(submitted.counter.id);assert.equal(receipt.status,'forwarded');
  const selected=(await db.query('select status,updated_at::text from public.dmca_cases where id=$1',[id(200)])).rows[0];
  const result=(await db.query('select public.transition_dmca_admin_case($1,$2,$3,$4,$5,$6)result',[id(200),id(2),'record_court_action',selected.status,selected.updated_at,'Synthetic court record'])).rows[0].result;
  assert.equal(result.status,'court_hold');
 }finally{await db.exec('rollback;set role service_role');}
});
