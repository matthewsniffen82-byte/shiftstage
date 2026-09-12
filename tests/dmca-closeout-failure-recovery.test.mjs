import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const root=repo;
const require=createRequire(repo+'package.json'),ts=require('typescript');
const {PublicApiError,resolveApiError}=await import('../src/lib/api-error-policy.ts');
const {safeErrorMetadata}=await import('../src/lib/security/safe-error-metadata.ts');
const compile=path=>ts.transpileModule(readFileSync(root+'/'+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const serviceCode=compile('src/lib/dancr/dmca.ts'),routeCode=compile('app/api/admin/dmca/route.ts');
const actor='a1700000-0000-4000-8000-000000000002',caseId='a1700000-0000-4000-8000-000000000200';
const input={resource:'agent',legalName:'Synthetic contact',email:'agent@example.invalid'};
const privateError=Object.assign(new Error('private mailbox@example.invalid token=secret'),{code:'08006'});
function harness({save='ok',audit='ok',mutateReceipt=x=>x,mutateAudit=x=>x,allowed=true,terminal='closed',missing=false,readError=false,activeRows=[]}={}){
 const events=[],logs=[];let stored=null,audited=null;
 const client={from(table){
  const filters=[],q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},in(key,value){events.push(['activeFilter',key,Array.from(value)]);return q;},order(){return q;},limit(value){assert.equal(value,100);return Promise.resolve({data:activeRows,error:null});},
   upsert(row){assert.equal(table,'dmca_agent_settings');events.push(['save',row]);stored={...row};return q;},
   insert(row){assert.equal(table,'admin_actions');events.push(['audit',row]);audited={id:'a1700000-0000-4000-8000-000000000500',...row};return q;},
   async single(){
    if(table==='dmca_agent_settings'){if(save==='throw')throw privateError;if(save==='error')return{data:stored,error:privateError};return{data:mutateReceipt({...stored}),error:null};}
    if(audit==='throw')throw privateError;if(audit==='error')return{data:audited,error:privateError};return{data:mutateAudit({...audited}),error:null};
   },
   then(resolve,reject){return q.single().then(resolve,reject);},
   async maybeSingle(){events.push(['read',table,filters]);if(table==='dmca_agent_settings'){assert.deepEqual(filters,[['id',true]]);return{data:stored,error:null};}
    assert.equal(table,'dmca_cases');assert.deepEqual(filters,[['id',caseId]]);return{data:missing?null:{id:caseId,status:terminal,updated_at:'2026-09-12T00:01:02.123456Z',dmca_counter_notices:[{id:'counter',status:'completed'}]},error:readError?privateError:null};
   }};return q;
 }};
 const service={};vm.runInNewContext(serviceCode,{exports:service,Error,Date,Number,console:{error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},require(name){
  if(name==='../api-error-policy')return{PublicApiError};if(name==='../security/safe-error-metadata')return{safeErrorMetadata};return{};
 }});
 const route={};vm.runInNewContext(routeCode,{exports:route,Error,URL,console:{error:(...args)=>logs.push(args)},require(name){
  if(name==='next/server')return{NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith('/api'))return{apiError(error,fallback,status){const result=resolveApiError(error,fallback,status);return Response.json(result.body,{status:result.status});}};
  if(name.endsWith('bounded-json-body'))return{readBoundedJsonObject:r=>r.json()};
  if(name.endsWith('dancr/admin'))return{async requireAdmin(){events.push(['guard']);if(!allowed)throw new PublicApiError('FORBIDDEN','Administrator access is required.',403);}};
  if(name.endsWith('dancr/dmca'))return service;
  if(name.endsWith('supabase/admin'))return{createAdminSupabaseClient(){events.push(['serviceClient']);return client;}};
  if(name.endsWith('supabase/request'))return{createRequestSupabaseContext:async()=>({client,user:{id:actor},session:null})};
  throw new Error(name);
 }});
 return{events,logs,get stored(){return stored;},get audited(){return audited;},
  patch:()=>route.PATCH(new Request('https://example.invalid/api/admin/dmca',{method:'PATCH',body:JSON.stringify({...input,adminId:'forged'})})),
  get:(id=caseId)=>route.GET(new Request('https://example.invalid/api/admin/dmca'+(id===null?'':'?caseId='+encodeURIComponent(id))))};
}
test('confirmed settings and checked audit receipt return saved values and verified actor',async()=>{
 const h=harness(),r=await h.patch(),body=await r.json();assert.equal(r.status,200);assert.equal(body.agent.email,input.email);assert.equal(body.partial,false);assert.equal(h.stored.updated_by,actor);assert.equal(h.audited.admin_id,actor);assert.deepEqual(h.events.filter(e=>['save','audit'].includes(e[0])).map(e=>e[0]),['save','audit']);assert.equal(body.agent.updated_by,undefined);
});
for(const audit of ['error','throw'])test('confirmed settings survive '+audit+' audit failure without another write',async()=>{
 const h=harness({audit}),r=await h.patch(),body=await r.json();assert.equal(r.status,200);assert.equal(body.partial,true);assert.equal(body.auditNeedsReview,true);assert.equal(body.agent.legalName,input.legalName);assert.match(body.message,/do not repeat the save/);assert.equal(h.events.filter(e=>e[0]==='save').length,1);assert.equal(h.events.filter(e=>e[0]==='audit').length,1);assert.doesNotMatch(JSON.stringify(h.logs),/mailbox|token=|secret/);
});
for(const [name,mutateAudit]of [['null',()=>null],['empty',()=>({})],['wrong actor',r=>({...r,admin_id:caseId})],['wrong action',r=>({...r,action:'delete'})],['wrong notes',r=>({...r,notes:'different'})]])test('unconfirmed '+name+' audit receipt preserves saved result and flags review',async()=>{
 const h=harness({mutateAudit}),r=await h.patch(),body=await r.json();assert.equal(r.status,200);assert.equal(body.auditNeedsReview,true);assert.equal(h.events.filter(e=>e[0]==='save').length,1);
});
for(const save of ['error','throw'])test('uncertain committed settings '+save+' require read review and never audit or repeat',async()=>{
 const h=harness({save}),r=await h.patch(),body=await r.json();assert.equal(r.status,503);assert.match(body.error,/Reload the saved contact details/);assert.equal(h.stored.email,input.email);assert.equal(h.events.filter(e=>e[0]==='save').length,1);assert.equal(h.audited,null);assert.doesNotMatch(JSON.stringify(h.logs),/mailbox|token=|secret/);
});
for(const [name,mutateReceipt]of [['null',()=>null],['array',()=>[]],['empty',()=>({})],['wrong singleton',r=>({...r,id:false})],['wrong actor',r=>({...r,updated_by:caseId})],['wrong email',r=>({...r,email:'other@example.invalid'})],['wrong registration',r=>({...r,registered_with_copyright_office:true})],['missing field',r=>({...r,organization:undefined})],['old time',r=>({...r,updated_at:'2026-09-01T00:00:00Z'})],['invalid time',r=>({...r,updated_at:'infinity'})]])test('committed '+name+' settings receipt cannot claim success or create audit',async()=>{
 const h=harness({mutateReceipt}),r=await h.patch();assert.equal(r.status,503);assert.equal(h.audited,null);assert.equal(h.events.filter(e=>e[0]==='save').length,1);
});
for(const terminal of ['closed','restored','rejected'])test('exact '+terminal+' case remains retrievable outside active list',async()=>{
 const h=harness({terminal}),r=await h.get(),body=await r.json();assert.equal(r.status,200);assert.equal(body.cases.length,1);assert.equal(body.cases[0].id,caseId);assert.equal(body.cases[0].status,terminal);assert.equal(body.cases[0].counterNotices[0].status,'completed');assert.equal(h.events.filter(e=>e[0]==='save'||e[0]==='audit').length,0);
});
test('selected case is included even beyond 100 active cases and is not duplicated',async()=>{
 const activeRows=Array.from({length:100},(_,i)=>({id:String(i),status:'submitted'}));activeRows[4]={id:caseId,status:'submitted'};
 const h=harness({activeRows}),r=await h.get(caseId.toUpperCase()),body=await r.json();assert.equal(body.cases.length,100);assert.equal(body.cases.filter(c=>c.id===caseId).length,1);assert.equal(body.cases[0].status,'closed');
});
test('missing selected case returns explicit 404 instead of silently disappearing',async()=>{const h=harness({missing:true}),r=await h.get();assert.equal(r.status,404);assert.match((await r.json()).error,/No action was repeated/);});
test('selected case read failure returns safe 503 without writes',async()=>{const h=harness({readError:true}),r=await h.get();assert.equal(r.status,503);assert.equal(h.stored,null);});
test('invalid case identity is rejected before database reads',async()=>{const h=harness(),r=await h.get('id.eq.secret');assert.equal(r.status,400);assert.equal(h.events.filter(e=>e[0]==='read'||e[0]==='activeFilter').length,0);});
test('ordinary active listing does not fetch an unrelated historical case',async()=>{const h=harness(),r=await h.get(null);assert.equal(r.status,200);assert.equal(h.events.filter(e=>e[0]==='read'&&e[1]==='dmca_cases').length,0);});
for(const method of ['get','patch'])test('unauthorized '+method+' cannot create a service client',async()=>{const h=harness({allowed:false}),r=await h[method]();assert.equal(r.status,403);assert.deepEqual(h.events,[['guard']]);});
