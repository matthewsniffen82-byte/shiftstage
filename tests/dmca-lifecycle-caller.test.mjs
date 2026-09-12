import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {database,seed,notice,takeDown,eligible,restore,snapshot,id,schema} from './helpers/dmca-lifecycle-database.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/[\\/]$/,''),require=createRequire(root+'/package.json');
const ts=require('typescript');
const {PublicApiError}=await import(pathToFileURL(root+'/src/lib/api-error-policy.ts').href);
const {safeErrorMetadata}=await import(pathToFileURL(root+'/src/lib/security/safe-error-metadata.ts').href);
const code=ts.transpileModule(readFileSync(new URL('../src/lib/dancr/dmca.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let db;
before(async()=>{db=await database();for(const path of ['ownership.sql','takedown.sql','restoration.sql'])await db.exec(readFileSync(new URL('./fixtures/dmca-lifecycle/'+path,import.meta.url),'utf8'));});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections,'public.dmca_enforcement_states'].join(','));await seed(db);await notice(db);});
function service({receipt=x=>x,email='success',lostResponse=false}={}){
 const events=[],logs=[],exports={};
 const client={
  from(table){
   assert.ok(['app_users','dmca_cases'].includes(table));const filters=[];
   const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},maybeSingle:async()=>{
    assert.deepEqual(filters.map(([key])=>key),['id']);
    const rows=(await db.query('select to_jsonb(t)result from public.'+table+' t where id=$1',[filters[0][1]])).rows;
    return{data:rows[0]?.result||null,error:null};
   }};return q;
  },
  async rpc(name,args){
   events.push({type:'rpc',name});assert.ok(['apply_dmca_takedown','restore_dmca_case'].includes(name));
   let result;
   try{result=(await db.query('select public.'+name+'($1,$2,$3)result',[args.p_case_id,args.p_admin_id,args.p_admin_notes??args.p_restoration_notes])).rows[0].result;}
   catch(error){return {data:null,error:{code:error.code}};}
   if(lostResponse)throw Object.assign(new Error('synthetic lost response'),{code:'08006'});
   return{data:receipt(result),error:null};
  }
 };
 vm.runInNewContext(code,{exports,Error,Date,Number,console:{error:(...args)=>logs.push(args)},require(name){
  if(['server-only','node:crypto','./public-request-rate-limit','./dmca-counter-submission'].includes(name))return{};
  if(name==='../api-error-policy')return{PublicApiError};
  if(name==='../security/safe-error-metadata')return{safeErrorMetadata};
  if(name==='./public-app-url')return{publicAppUrl:()=> 'https://example.invalid'};
  if(name==='./notification-delivery')return{async sendTransactionalEmail(input){events.push({type:'email',input});if(email==='throw')throw new Error('synthetic provider failure');return{delivered:email==='success'};}};
  throw new Error('Unexpected bridge dependency '+name);
 }});
 return{events,logs,run:(action='restore')=>exports.applyDmcaAdminAction(client,id(2),id(200),action,'Synthetic bridge review')};
}
test('actual caller accepts native takedown and restoration receipts',async()=>{
 const h=service();const taken=await h.run('disable');assert.equal(taken.activeStrikes,1);assert.equal(taken.status,'disabled');
 await eligible(db);const result=await h.run();assert.equal(result.status,'restored');assert.equal(result.restorationOutcome,'previous_state_restored');assert.equal(result.contentStatus,'approved');
 const mail=h.events.filter(e=>e.type==='email').at(-1).input;assert.match(mail.subject,/resolved/);assert.match(mail.text,/Other account or content restrictions/);assert.doesNotMatch(mail.text,/material.*was restored/);
});
test('another active copyright case remains hidden through the actual caller',async()=>{
 await takeDown(db);await notice(db,201,100);await takeDown(db,201);await eligible(db);const h=service(),result=await h.run();
 assert.equal(result.restorationOutcome,'another_active_case');assert.equal(result.contentStatus,'hidden');
 assert.equal((await snapshot(db)).mydancr_tv_videos.find(v=>v.id===id(100)).status,'hidden');
 assert.doesNotMatch(h.events.find(e=>e.type==='email').input.text,/material.*was restored/);
});
test('later independent moderation is preserved through the caller receipt',async()=>{
 await takeDown(db);await eligible(db);await db.query("update public.mydancr_tv_videos set status='hidden' where id=$1",[id(100)]);
 const result=await service().run();assert.equal(result.restorationOutcome,'independent_decision_preserved');assert.equal(result.contentStatus,'hidden');
});
test('a deleted account resolves only its retained case through the caller',async()=>{
 await takeDown(db);await eligible(db);await db.query('delete from public.app_users where id=$1',[id(1)]);
 const result=await service().run();assert.equal(result.uploaderId,null);assert.equal(result.restorationOutcome,'missing_content');assert.equal(result.contentStatus,null);
});
for(const email of ['false','throw']){
 test('native confirmed case survives email '+email,async()=>{
  await takeDown(db);await eligible(db);const h=service({email}),result=await h.run();assert.equal(result.status,'restored');assert.equal(result.deliveryNeedsReview,true);
  assert.equal((await snapshot(db)).dmca_cases[0].status,'restored');assert.equal(h.events.filter(e=>e.type==='rpc').length,1);
 });
}
test('lost native commit response preserves the action and sends no completion mail',async()=>{
 await takeDown(db);await eligible(db);const h=service({lostResponse:true});await assert.rejects(h.run(),e=>e.status===503);
 assert.equal((await snapshot(db)).dmca_cases[0].status,'restored');assert.equal(h.events.filter(e=>e.type==='rpc').length,1);assert.equal(h.events.filter(e=>e.type==='email').length,0);
});
test('legacy restoration receipts remain compatible with neutral messaging',async()=>{
 await takeDown(db);await eligible(db);const h=service({receipt:({restorationOutcome,contentStatus,...value})=>value});
 const result=await h.run();assert.equal(result.status,'restored');assert.equal(result.restorationOutcome,undefined);assert.equal(result.contentStatus,undefined);
 assert.match(h.events.find(e=>e.type==='email').input.text,/Other account or content restrictions/);
});
for(const value of [
 {restorationOutcome:null},{restorationOutcome:'unknown'},{restorationOutcome:true},{restorationOutcome:undefined},
 {contentStatus:undefined},{contentStatus:3},{contentStatus:'published'},
 {restorationOutcome:'missing_content',contentStatus:'approved'},{restorationOutcome:'previous_state_restored',contentStatus:null}
]){
 test('malformed optional native outcome is unconfirmed: '+JSON.stringify(value),async()=>{
  await takeDown(db);await eligible(db);const h=service({receipt:r=>({...r,...value})});await assert.rejects(h.run(),e=>e.status===503);
  assert.equal((await snapshot(db)).dmca_cases[0].status,'restored');assert.equal(h.events.filter(e=>e.type==='email').length,0);
 });
}
