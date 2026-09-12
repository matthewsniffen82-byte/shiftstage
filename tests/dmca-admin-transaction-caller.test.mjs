import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {database,seed,notice,takeDown,eligible,snapshot,id,schema} from './helpers/dmca-case-callers-database.mjs';
import {operatorQuery} from './helpers/dmca-case-callers-database.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'/package.json'),ts=require('typescript');
const {PublicApiError,resolveApiError}=await import(pathToFileURL(root+'/src/lib/api-error-policy.ts').href);
const {safeErrorMetadata}=await import(pathToFileURL(root+'/src/lib/security/safe-error-metadata.ts').href);
const compile=file=>ts.transpileModule(readFileSync(sourceRoot+'/'+({ 'dmca.ts':'src/lib/dancr/dmca.ts', 'route.ts':'app/api/admin/dmca/route.ts' }[file]),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const code=compile('dmca.ts'),routeCode=compile('route.ts');
let db;
// Load independently captured deployed definitions and permissions directly.
before(async()=>{db=await database();});

after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections].join(','));await seed(db);await notice(db);});
const version=async()=>(await db.query('select to_jsonb(updated_at)value from public.dmca_cases where id=$1',[id(200)])).rows[0].value;
const privateError=Object.assign(new Error('private claimant address and mailbox@example.invalid'),{code:'08006'});
function harness({receipt=x=>x,lost=false,email='success',allowed=true,beforeRpc=async()=>{},nativeError=null}={}){
 const events=[],logs=[],library={};
 const client={from(table){
  assert.equal(table,'dmca_cases');const filters=[];
  const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},maybeSingle:async()=>{
   assert.deepEqual(filters,[['id',id(200)]]);return{data:(await db.query('select to_jsonb(t)value from public.dmca_cases t where id=$1',[id(200)])).rows[0]?.value??null,error:null};
  }};return q;
 },async rpc(name,args){
  assert.equal(name,'transition_dmca_admin_case');events.push({type:'rpc',args});await beforeRpc();
  if(nativeError)return{data:null,error:{code:nativeError,message:privateError.message}};
  let result;try{result=(await db.query('select public.transition_dmca_admin_case($1,$2,$3,$4,$5,$6)result',[args.p_case_id,args.p_admin_id,args.p_action,args.p_expected_status,args.p_expected_updated_at,args.p_notes])).rows[0].result;}
  catch(error){return{data:null,error:{code:error.code,message:privateError.message}};}
  if(lost)throw privateError;return{data:receipt(result),error:null};
 }};
 vm.runInNewContext(code,{exports:library,Error,Date,Number,console:{error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},require(name){
  if(['server-only','node:crypto','./public-request-rate-limit','./dmca-counter-submission'].includes(name))return{};
  if(name==='../api-error-policy')return{PublicApiError};if(name==='../security/safe-error-metadata')return{safeErrorMetadata};
  if(name==='./public-app-url')return{publicAppUrl:()=> 'https://example.invalid'};
  if(name==='./notification-delivery')return{async sendTransactionalEmail(input){events.push({type:'email',input});if(email==='throw')throw privateError;return{delivered:email==='success'};}};
  throw new Error('Unexpected admin bridge import '+name);
 }});
 const route={};vm.runInNewContext(routeCode,{exports:route,Error,console:{error:(...args)=>logs.push(args)},require(name){
  if(name==='next/server')return{NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith('/api'))return{apiError(error,fallback,status){const result=resolveApiError(error,fallback,status);return Response.json(result.body,{status:result.status});}};
  if(name.endsWith('bounded-json-body'))return{readBoundedJsonObject:r=>r.json()};
  if(name.endsWith('dancr/admin'))return{async requireAdmin(selected,actor){assert.equal(selected,client);assert.equal(actor,id(2));events.push({type:'guard'});if(!allowed)throw new PublicApiError('FORBIDDEN','Administrator access is required.',403);}};
  if(name.endsWith('dancr/dmca'))return library;
  if(name.endsWith('supabase/admin'))return{createAdminSupabaseClient(){events.push({type:'adminClient'});return client;}};
  if(name.endsWith('supabase/request'))return{createRequestSupabaseContext:async()=>({client,user:{id:id(2)},session:null})};
  throw new Error('Unexpected admin route bridge import '+name);
 }});
 return{events,logs,run:async(action='request_information',selected)=>library.applyDmcaAdminAction(client,id(2),id(200),action,'Synthetic review',selected===undefined?await version():selected),
  http:async(body={})=>route.PATCH(new Request('https://example.invalid/api/admin/dmca',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({caseId:id(200),action:'request_information',notes:'Synthetic review',expectedUpdatedAt:await version(),...body})}))};
}
async function prepare(action){if(['record_court_action','close'].includes(action)){await takeDown(db);await eligible(db);if(action==='close')await db.query("update public.dmca_cases set status='court_hold',court_filing_received=true where id=$1",[id(200)]);}}
for(const [action,status]of [['request_information','needs_information'],['reject','rejected'],['record_court_action','court_hold'],['close','closed']])test('actual HTTP caller commits and checks '+action,async()=>{
 await prepare(action);const h=harness(),response=await h.http({action,adminId:id(3)}),body=await response.json(),after=await snapshot(db);
 assert.equal(response.status,200);assert.equal(body.result.status,status);assert.equal(body.partial,false);assert.equal(after.dmca_cases[0].status,status);assert.equal(after.admin_actions.at(-1).admin_id,id(2));
 assert.equal(h.events.filter(e=>e.type==='rpc').length,1);assert.equal(h.events.filter(e=>e.type==='email').length,['request_information','reject'].includes(action)?1:0);
 assert.equal(h.events.find(e=>e.type==='rpc').args.p_admin_id,id(2));
});
for(const selected of [null,'',true,23,{},'not-a-date','infinity','2026-09-12', '2026-09-12T12:00:00.1234567Z'])test('invalid displayed version cannot mutate: '+JSON.stringify(selected),async()=>{
 const h=harness(),before=await snapshot(db);await assert.rejects(h.run('reject',selected),e=>e.status===409);assert.equal(h.events.length,0);assert.deepEqual(await snapshot(db),before);
});
test('six-digit fractional version travels unchanged from HTTP to PostgreSQL',async()=>{
 await db.query('update public.dmca_cases set updated_at=$1 where id=$2',['2026-09-12T00:01:02.123456Z',id(200)]);
 const selected=await version();assert.match(selected,/\.123456/);const h=harness(),response=await h.http({expectedUpdatedAt:selected});assert.equal(response.status,200);assert.equal(h.events.find(e=>e.type==='rpc').args.p_expected_updated_at,selected);
});
test('an older screen without a displayed version receives a conflict before mutation',async()=>{
 const before=await snapshot(db),h=harness(),response=await h.http({expectedUpdatedAt:undefined});assert.equal(response.status,409);assert.equal(h.events.filter(e=>e.type==='rpc'||e.type==='email').length,0);assert.deepEqual(await snapshot(db),before);
});
for(const timing of ['before-read','after-read'])test('changed version '+timing+' returns 409 without mail or new audit',async()=>{
 const selected=await version(),change=()=>db.exec("update public.dmca_cases set updated_at=updated_at+interval '1 second'");
 if(timing==='before-read')await change();const before=await snapshot(db),h=harness({beforeRpc:timing==='after-read'?change:undefined}),response=await h.http({expectedUpdatedAt:selected});
 assert.equal(response.status,409);assert.equal(h.events.filter(e=>e.type==='email').length,0);assert.deepEqual((await snapshot(db)).admin_actions,before.admin_actions);assert.equal((await snapshot(db)).dmca_cases[0].status,'submitted');
});
for(const action of ['request_information','reject'])for(const email of ['false','throw'])test(action+' remains complete when email '+email,async()=>{
 const h=harness({email}),response=await h.http({action}),body=await response.json();assert.equal(response.status,200);assert.equal(body.partial,true);assert.equal(body.result.deliveryNeedsReview,true);assert.match(body.message,/do not repeat the completed action/);assert.doesNotMatch(body.message,/claimant was notified/);
 assert.equal(h.events.filter(e=>e.type==='rpc').length,1);assert.equal(h.events.filter(e=>e.type==='email').length,1);assert.doesNotMatch(JSON.stringify(h.logs),/private claimant|mailbox@example/);
});
for(const [name,receipt]of [['null',()=>null],['array',()=>[]],['empty',()=>({})],['wrong case',r=>({...r,caseId:id(999)})],['wrong state',r=>({...r,status:'closed'})],['missing time',r=>({...r,updatedAt:undefined})],['date only',r=>({...r,updatedAt:'2026-09-12'})],['infinite time',r=>({...r,updatedAt:'infinity'})]])test('committed but malformed '+name+' receipt sends no completion mail',async()=>{
 const h=harness({receipt}),response=await h.http(),body=await response.json();assert.equal(response.status,503);assert.equal(body.ok,false);assert.equal(h.events.filter(e=>e.type==='rpc').length,1);assert.equal(h.events.filter(e=>e.type==='email').length,0);assert.equal((await snapshot(db)).dmca_cases[0].status,'needs_information');
});
test('lost committed response returns 503 and does not retry the case or email',async()=>{
 const h=harness({lost:true}),response=await h.http();assert.equal(response.status,503);assert.equal(h.events.filter(e=>e.type==='rpc').length,1);assert.equal(h.events.filter(e=>e.type==='email').length,0);assert.equal((await snapshot(db)).dmca_cases[0].status,'needs_information');assert.doesNotMatch(JSON.stringify(h.logs),/private claimant|mailbox@example/);
});
for(const [nativeError,status]of [['42501',403],['P0002',404],['40001',409],['22023',400],['22007',400],['22008',400],['PGRST202',503],['08006',503]])test('native '+nativeError+' receives safe HTTP '+status,async()=>{
 const before=await snapshot(db),h=harness({nativeError}),response=await h.http(),body=await response.json();assert.equal(response.status,status);assert.doesNotMatch(JSON.stringify(body),/private claimant|mailbox@example/);assert.deepEqual(await snapshot(db),before);assert.equal(h.events.filter(e=>e.type==='email').length,0);
});
test('HTTP denies unauthorized actor before creating service client or executing a write',async()=>{
 const h=harness({allowed:false}),response=await h.http();assert.equal(response.status,403);assert.deepEqual(h.events,[{type:'guard'}]);
});
test('disabled real administrator is denied by the native boundary',async()=>{
 await operatorQuery(db,"update public.app_users set account_state='disabled' where id=$1",[id(2)]);const before=await snapshot(db),h=harness(),response=await h.http();assert.equal(response.status,403);assert.equal(h.events.filter(e=>e.type==='email').length,0);assert.deepEqual(await snapshot(db),before);
});
test('unreviewed native fields are not projected into the HTTP result',async()=>{
 const h=harness({receipt:r=>({...r,privateAddress:'Private street',internalValue:123})}),response=await h.http(),body=await response.json();assert.equal(response.status,200);assert.deepEqual(Object.keys(body.result).sort(),['caseId','deliveryNeedsReview','status','updatedAt']);
});
