import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import * as commissionPolicy from '../src/lib/dancr/commission-policy.ts';
const owner='b2800000-0000-4000-8000-000000000001',dancer='b2800000-0000-4000-8000-000000000002';
const copy=value=>JSON.parse(JSON.stringify(value));
function load(path,dependencies={}){
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Date,Set,Map,URL,Blob,Buffer,console:{log(){},warn(){},error(){}},
  require(name){if(Object.hasOwn(dependencies,name))return dependencies[name];return new Proxy({},{get(_t,key){if(key==='__esModule')return false;return()=>assert.fail('Unexpected dependency '+name+'.'+String(key));}});},
 });return exports;
}
function clients({ownerError,missing=false,stopPrivate}={}){
 const ownerCalls=[],privateCalls=[];
 const server={from(table){assert.equal(table,'dancer_profiles','Only the own-profile lookup may use the server');const call={table,methods:[]};ownerCalls.push(call);const q={
  select(fields){assert.equal(fields,'id');call.methods.push(['select',fields]);return q;},
  eq(field,value){assert.equal(field,'user_id');assert.equal(value,owner);call.methods.push(['eq',field,value]);return q;},
  async maybeSingle(){return {data:missing?null:{id:dancer},error:ownerError||null};},
 };return q;}};
 const request={from(table){assert.notEqual(table,'dancer_profiles','The request role cannot filter the private account identifier');if(stopPrivate)throw stopPrivate;const call={table,methods:[]};privateCalls.push(call);const q=new Proxy({},{get(_t,key){
  if(key==='then')return(ok,bad)=>Promise.resolve({data:call.methods.some(([m])=>m==='maybeSingle')?null:[],count:0,error:null}).then(ok,bad);
  return(...args)=>{assert.ok(!['insert','upsert','update','delete'].includes(key),'Read workflows must not mutate records');call.methods.push([key,...args]);return q;};
 }});return q;}};
 return {server,request,ownerCalls,privateCalls};
}
const library=load('src/lib/dancr/dancer.ts'),deals=load('src/lib/dancr/deals.ts',{'./commission-policy':commissionPolicy});
const readers=['getOwnDancerDashboardAnalytics','getOwnDancerWeeklyReport','getDancerRankingEvents','getOwnDancerApprovalReviews'];
for(const name of [...readers,'getDancerDealMetrics']){
 const fn=name==='getDancerDealMetrics'?deals[name]:library[name];
 test(name+' resolves only the authenticated owner through the server and retains request-role data reads',async()=>{
  const h=clients();await fn(h.request,owner,h.server);
  assert.deepEqual(copy(h.ownerCalls),[{table:'dancer_profiles',methods:[['select','id'],['eq','user_id',owner]]}]);assert.ok(h.privateCalls.length>0);
  assert.ok(h.privateCalls.every(call=>call.methods.some(([m,field,value])=>(m==='eq'&&['dancer_id','qr_redemptions.dancer_id','shifts.dancer_id'].includes(field)&&value===dancer)||(m==='contains'&&field==='payload'&&value.dancerId===dancer))));
 });
 test(name+' stops on failed owner resolution without a private data query or fallback',async()=>{
  const error={code:'08006'},h=clients({ownerError:error});await assert.rejects(fn(h.request,owner,h.server),e=>e===error);assert.equal(h.privateCalls.length,0);assert.equal(h.ownerCalls.length,1);
 });
 test(name+' does not query another profile when the owner profile is absent',async()=>{
  const h=clients({missing:true});if(name==='getDancerDealMetrics')assert.equal(await fn(h.request,owner,h.server),null);else await assert.rejects(fn(h.request,owner,h.server),/profile not found/);assert.equal(h.privateCalls.length,0);
 });
}
for(const name of ['deleteOwnDancerPhoto','deleteOwnDancerAvatar'])test(name+' resolves the private owner before any media access',async()=>{
 const h=clients({missing:true});const args=name==='deleteOwnDancerPhoto'?[h.request,owner,'synthetic-photo',h.server]:[h.request,owner,h.server];
 await assert.rejects(library[name](...args),/profile not found/);assert.equal(h.ownerCalls.length,1);assert.equal(h.privateCalls.length,0);
});
const routes=[['analytics',readers[0]],['weekly-report',readers[1]],['ranking-events',readers[2]],['reviews',readers[3]]];
for(const[route,reader]of routes)for(const denied of [false,true])test(route+' keeps authenticated identity and authorization before the private lookup; denied='+denied,async()=>{
 let created=0,read=0;const requestClient={},server={};
 const handler=load('app/api/dancer/'+route+'/route.ts',{
  'next/server':{NextResponse:{json:Response.json}},
  '@/src/lib/api':{apiError(error,fallback){const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
  '@/src/lib/supabase/request':{async createRequestSupabaseContext(_request,access){assert.deepEqual(copy(access),{role:'dancer'});if(denied)throw new PublicApiError('FORBIDDEN','Account unavailable.',403);return {client:requestClient,user:{id:owner}};}},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient(){created++;return server;}},
  '@/src/lib/dancr/dancer':{async[reader](client,userId,ownerClient){assert.equal(client,requestClient);assert.equal(userId,owner);assert.equal(ownerClient,server);read++;return []; }},
 });
 const response=await handler.GET(new Request('https://example.test/api/dancer/'+route+'?userId=someone-else&dancerId=someone-else'));
 assert.equal(response.status,denied?403:200);assert.equal(created,denied?0:1);assert.equal(read,denied?0:1);
});
