import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {database,seed,notice,takeDown,snapshot,id,schema} from './helpers/dmca-case-callers-database.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'/package.json'),ts=require('typescript');
const {PublicApiError}=await import(pathToFileURL(root+'/src/lib/api-error-policy.ts').href);
const {safeErrorMetadata}=await import(pathToFileURL(root+'/src/lib/security/safe-error-metadata.ts').href);
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const code=compile(readFileSync(sourceRoot+'/src/lib/dancr/dmca.ts','utf8')),actions={};
vm.runInNewContext(compile(readFileSync(root+'/src/lib/dancr/dmca-counter-submission.ts','utf8')),{exports:actions,Error,require:()=>({PublicApiError})});
const details={legalName:'Synthetic dancer',email:'dancer@example.invalid',phone:'5555555555',address:'123 Synthetic street',removedMaterialLocation:'https://example.invalid/synthetic',signature:'Synthetic dancer',mistakeBeliefConfirmed:true,perjuryConfirmed:true,jurisdictionConfirmed:true,serviceConfirmed:true};
const privateError=Object.assign(new Error('private counter address mailbox@example.invalid'),{code:'08006'});
let db;
// Load independently captured deployed definitions and permissions directly.
before(async()=>{db=await database();});

after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections].join(','));await seed(db);await notice(db);await takeDown(db);});
const counter=async()=>(await db.query('select to_jsonb(t)result from public.dmca_counter_notices t')).rows[0]?.result;
function harness({mode='success',delivered=true,receipt=x=>x,read=x=>x,afterEmail=async()=>{}}={}){
 const events=[],logs=[],library={};
 const client={async rpc(name,args){
  events.push({type:'rpc',name,args});assert.ok(['submit_dmca_counter_notice_safely','confirm_dmca_counter_forwarding'].includes(name));
  if(name==='submit_dmca_counter_notice_safely')return{data:(await db.query('select public.submit_dmca_counter_notice_safely($1,$2,$3)result',[args.p_user_id,args.p_case_id,JSON.stringify(args.p_details)])).rows[0].result,error:null};
  if(['error','read-error'].includes(mode))return{data:null,error:privateError};
  if(mode==='throw')throw privateError;
  let data;try{data=(await db.query('select public.confirm_dmca_counter_forwarding($1,$2)result',[args.p_counter_id,args.p_case_id])).rows[0].result;}catch(error){return{data:null,error:{code:error.code}};}
  if(mode==='commit-throw')throw privateError;if(mode==='commit-error')return{data:null,error:privateError};
  return{data:mode==='commit-empty'?null:receipt(data),error:null};
 },from(table){
  assert.ok(['dmca_counter_notices','notifications'].includes(table));const filters=[];let values,selected;
  const q={select(columns){selected=columns;return q;},eq(key,value){filters.push([key,value]);return q;},is(key,value){filters.push([key,value]);return q;},order(){return q;},limit(){return q;},
   insert(input){assert.equal(table,'notifications','Signed counter insertion must remain atomic');values=input;return q;},
   update(){assert.fail('No direct counter/case update is permitted');},delete(){assert.fail('No compensation is permitted');},
   maybeSingle:run,then(resolve,reject){return run().then(resolve,reject);}};
  async function run(){
   if(table==='notifications'){events.push({type:'notification',values});return{data:null,error:null};}
   events.push({type:'read',filters,selected});
   if(filters.some(([key])=>key==='dmca_cases.status')){
    assert.deepEqual(filters,[['status','submitted'],['forwarded_to_claimant_at',null],['dmca_cases.status','countered']]);
    return{data:(await db.query("select to_jsonb(n)||jsonb_build_object('dmca_cases',to_jsonb(c))result from public.dmca_counter_notices n join public.dmca_cases c on c.id=n.case_id where n.status='submitted'and n.forwarded_to_claimant_at is null and c.status='countered' order by n.created_at limit 25")).rows.map(r=>r.result),error:null};
   }
   if(mode==='read-error')return{data:null,error:privateError};
   const found=await counter();assert.deepEqual(filters,[['id',found.id],['case_id',id(200)]]);return{data:read(found),error:null};
  }
  return q;
 }};
 vm.runInNewContext(code,{exports:library,Error,Date,Number,console:{warn:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},require(name){
  if(name==='./dmca-counter-submission')return actions;
  if(name==='../api-error-policy')return{PublicApiError};if(name==='../security/safe-error-metadata')return{safeErrorMetadata};
  if(name==='./notification-delivery')return{async sendTransactionalEmail(){events.push({type:'email'});await afterEmail();return{delivered};}};
  if(['server-only','node:crypto','./public-request-rate-limit','./public-app-url'].includes(name))return{};
  throw new Error('Unexpected forwarding bridge import '+name);
 }});
 return{events,logs,submit:()=>library.submitDmcaCounterNotice(client,id(1),id(200),details),worker:()=>library.forwardPendingDmcaCounterNotices(client)};
}
async function seedCounter(){await db.query('select public.submit_dmca_counter_notice_safely($1,$2,$3)',[id(1),id(200),JSON.stringify(details)]);}
for(const worker of [false,true])for(const mode of ['success','commit-error','commit-throw','commit-empty'])test((worker?'scheduled':'submitted')+' actual forwarding confirms '+mode+' without repeating mail',async()=>{
 if(worker)await seedCounter();const h=harness({mode}),result=await(worker?h.worker():h.submit());assert.equal(worker?result[0].forwarded:result.status,true===worker?true:'forwarded');
 assert.equal((await counter()).status,'forwarded');assert.equal(h.events.filter(e=>e.type==='email').length,1);assert.equal(h.events.filter(e=>e.name==='confirm_dmca_counter_forwarding').length,1);
 assert.equal(h.events.filter(e=>e.type==='read'&&!e.filters.some(([key])=>key==='dmca_cases.status')).length,mode==='success'?0:1);assert.doesNotMatch(JSON.stringify(h.logs),/private counter|mailbox@example/);
});
for(const worker of [false,true])for(const mode of ['error','throw','read-error'])test((worker?'scheduled':'submitted')+' unconfirmed forwarding '+mode+' leaves signed counter for review',async()=>{
 if(worker)await seedCounter();const h=harness({mode});
 if(worker)await assert.rejects(h.worker(),/Review the case before retrying/);else{const result=await h.submit();assert.equal(result.status,'submitted');assert.equal(result.deliveryNeedsReview,true);}
 assert.equal((await counter()).status,'submitted');assert.equal(h.events.filter(e=>e.type==='email').length,1);assert.equal(h.events.filter(e=>e.name==='confirm_dmca_counter_forwarding').length,1);assert.doesNotMatch(JSON.stringify(h.logs),/private counter|mailbox@example/);
});
for(const worker of [false,true])test((worker?'scheduled':'submitted')+' unacknowledged provider sends no forwarding RPC',async()=>{
 if(worker)await seedCounter();const h=harness({delivered:false}),result=await(worker?h.worker():h.submit());assert.equal(worker?result[0].forwarded:result.status,worker?false:'submitted');assert.equal((await counter()).status,'submitted');assert.equal(h.events.filter(e=>e.name==='confirm_dmca_counter_forwarding').length,0);
});
for(const mutate of [r=>({...r,id:id(999)}),r=>({...r,case_id:id(999)}),r=>({...r,status:'withdrawn'}),r=>({...r,forwarded_to_claimant_at:null}),r=>({...r,forwarded_to_claimant_at:'2026-09-12'}),()=>[]])test('malformed RPC and reconciliation receipts stay unconfirmed: '+mutate.toString(),async()=>{
 const h=harness({receipt:mutate,read:mutate}),result=await h.submit();assert.equal(result.deliveryNeedsReview,true);assert.equal(result.status,'submitted');assert.equal((await counter()).status,'forwarded');assert.equal(h.events.filter(e=>e.name==='confirm_dmca_counter_forwarding').length,1);assert.equal(h.events.filter(e=>e.type==='email').length,1);
});
test('a completed notice with original forwarding evidence is never rewound or reported merely submitted',async()=>{
 const h=harness({afterEmail:()=>db.exec("update public.dmca_counter_notices set status='completed',forwarded_to_claimant_at=now()-interval '1 minute'")}),result=await h.submit();assert.equal(result.status,'completed');assert.equal(result.deliveryNeedsReview,false);assert.equal((await counter()).status,'completed');
});
test('a court hold committed while mail was being sent is preserved',async()=>{
 const h=harness({afterEmail:()=>db.exec("update public.dmca_cases set status='court_hold',court_filing_received=true")}),result=await h.submit();assert.equal(result.status,'forwarded');assert.equal((await snapshot(db)).dmca_cases[0].status,'court_hold');
});
test('a withdrawn notice while mail was being sent is not overwritten',async()=>{
 const h=harness({afterEmail:()=>db.exec("update public.dmca_counter_notices set status='withdrawn'")}),result=await h.submit();assert.equal(result.deliveryNeedsReview,true);assert.equal((await counter()).status,'withdrawn');
});
test('duplicate signed submission after a confirmed delivery neither resends mail nor acknowledges twice',async()=>{
 const h=harness();await h.submit();const before=await snapshot(db),result=await h.submit();assert.equal(result.duplicate,true);assert.equal(result.status,'forwarded');assert.deepEqual(await snapshot(db),before);assert.equal(h.events.filter(e=>e.type==='email').length,1);assert.equal(h.events.filter(e=>e.name==='confirm_dmca_counter_forwarding').length,1);
});
test('current caller completes submission and acknowledgment with direct writes denied',async()=>{
 await db.exec('reset role;begin;revoke insert,update,delete on public.dmca_cases,public.dmca_counter_notices,public.dmca_strikes from public,anon,authenticated,service_role;set role service_role');
 try{const h=harness(),result=await h.submit();assert.equal(result.status,'forwarded');assert.equal((await counter()).status,'forwarded');}finally{await db.exec('rollback;set role service_role');}
});
