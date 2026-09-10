import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';

const id='00000000-0000-4000-8000-000000000001';
const privateMessage='Synthetic private SQL /srv/config.ts bearer=finance-canary';
const code=new Map();
function load(file,dependencies,logs){
  if(!code.has(file))code.set(file,ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
  const exports={};
  vm.runInNewContext(code.get(file),{exports,Error,console:{error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},require:name=>dependencies[name]||{}});
  return exports;
}
const jobs=[
  ['run_automation',['run'],{invoicesCreated:2,invoicesOpened:1,invoicesReconciled:3,remindersSent:1,payoutsCreated:0,payoutsFailed:0,natsExportsCreated:1,natsExportsFailed:0,natsReconciliationRequired:1}],
  ['process_payouts',['payouts'],{created:2,failed:1,disabled:false,settlementProvider:'nats'}],
  ['verify_nats_affiliate',['verify','sync'],{exported:2,failed:1,reconciliationRequired:1,disabled:false}],
  ['retry_nats_export',['retry','sync'],{exported:2,failed:1,reconciliationRequired:1,disabled:false}],
  ['reconcile_nats_export',['reconcile','sync'],{exported:2,failed:1,reconciliationRequired:1,disabled:false}],
];
function harness(job,{errors=[privateMessage],refreshFails=false,customer=false,noAuth=false}={}){
  const logs=[],calls=[],summary=Object.freeze({...job[2],errors:Object.freeze(errors)});
  const finance={metrics:{paidClubRevenueCents:1200}};
  const client={from(table){assert.equal(table,'app_users');const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{id,role:customer?'customer':'admin',account_state:'active'},error:null};}};return q;}};
  const helper=load('src/lib/dancr/finance-admin-result.ts',{'../security/safe-error-metadata.ts':{safeErrorMetadata}},logs);
  const inputs=load('src/lib/dancr/finance-admin-input.ts',{},logs);
  const action=(name,returns)=>async(received,...args)=>{assert.equal(received,client);calls.push({name,args});return returns;};
  const reporting={async getAdminFinanceOverview(received){assert.equal(received,client);calls.push({name:'refresh'});if(refreshFails)throw Object.assign(new Error(privateMessage),{code:'08006'});return finance;}};
  const dispatcher=load('src/lib/dancr/finance-admin-dispatch.ts',{
    './finance-admin-input':inputs,'./finance-admin-result':helper,'./finance-reporting':reporting,
    './finance-automation':{runQrFinanceAutomation:action('run',summary)},
    './finance-payout-processing':{processDancerPayouts:action('payouts',summary)},
    './nats-commission-sync':{syncNatsCommissions:action('sync',summary)},
    './nats-affiliate-actions':{verifyNatsAffiliateLink:action('verify'),retryFailedNatsCommissionExport:action('retry'),reconcileNatsCommissionExport:action('reconcile')},
  },logs);
  const admin=load('src/lib/dancr/admin.ts',{'../api-error-policy':{PublicApiError},'../security/safe-error-metadata':{safeErrorMetadata}},logs);
  const route=load('app/api/admin/finance/route.ts',{
    'next/server':{NextResponse:{json:Response.json}},
    '@/src/lib/api':{apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject:r=>r.json()},
    '@/src/lib/dancr/admin':admin,'@/src/lib/dancr/finance-admin-dispatch':dispatcher,
    '@/src/lib/dancr/finance-reporting':reporting,'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/supabase/request':{async createRequestSupabaseContext(){if(noAuth)throw new Error('Sign in required.');return {client,user:{id},session:null};}},
  },logs);
  return {calls,logs,summary,finance,async send(extra={}){
    const response=await route.POST(new Request('https://example.test/api/admin/finance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:job[0],dancerId:id,exportId:id,reason:'Synthetic review',resolution:'confirmed_not_exported',...extra})}));
    return {status:response.status,body:await response.json()};
  }};
}
for(const job of jobs)for(const refreshFails of [false,true])for(const errors of [[privateMessage],[privateMessage,{message:privateMessage,details:privateMessage}],[]])test(job[0]+' conceals '+errors.length+' aggregate errors with refresh '+String(!refreshFails),async()=>{
  const h=harness(job,{errors,refreshFails}),r=await h.send();
  assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.session,null);
  const {errors:messages,...counts}=r.body.result;
  assert.deepEqual(counts,job[2]);assert.equal(messages.length,errors.length);
  for(const message of messages)assert.match(message,/Check current invoice and payout states before retrying/);
  assert.doesNotMatch(JSON.stringify([r.body,h.logs]),/finance-canary|Synthetic private|\/srv\/config/);
  assert.deepEqual(h.calls.map(c=>c.name),[...job[1],'refresh']);
  assert.deepEqual(h.summary.errors,errors,'Sanitizing responses does not mutate the internal outcome');
  if(refreshFails){assert.equal(r.body.financeRefreshRequired,true);assert.equal('finance' in r.body,false);assert.equal(h.logs.length,1);assert.equal(h.logs[0][1].code,'08006');}
  else{assert.deepEqual(r.body.finance,h.finance);assert.equal('financeRefreshRequired' in r.body,false);}
});
for(const [option,status] of [['noAuth',401],['customer',403]])test('finance error handling preserves '+option+' denial before all actions',async()=>{
  const h=harness(jobs[0],{[option]:true}),r=await h.send();assert.equal(r.status,status);assert.deepEqual(h.calls,[]);
});
test('invalid finance commands never reach automation or reporting',async()=>{
  const h=harness(jobs[0]),r=await h.send({action:'unsupported'});assert.equal(r.status,400);assert.deepEqual(h.calls,[]);
});
test('confirming an already exported invoice does not dispatch it again',async()=>{
  const h=harness(jobs[4]),r=await h.send({resolution:'confirmed_exported'});assert.equal(r.status,200);assert.equal(r.body.result,null);
  assert.deepEqual(h.calls.map(c=>c.name),['reconcile','refresh']);
  assert.equal(h.calls[0].args[2],'confirmed_exported');
});
