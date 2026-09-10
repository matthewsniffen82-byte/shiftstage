import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';
const source=readFileSync(new URL('../app/api/admin/tv/import/route.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id=n=>'95000000-0000-4000-8000-'+String(n).padStart(12,'0');
const key='synthetic-import-key-only-32-bytes!';
const validVideo={fileSize:5000,durationSeconds:5,width:360,height:640,mimeType:'video/mp4',distributionScope:'profile_and_feed'};
function harness(options={}){
 const rows=new Map(),audits=[],warnings=[],queries=[],created=[],files=new Set(),route={};let adminClients=0;
 const dancer={id:id(11),user_id:id(1),stage_name:'Synthetic dancer',slug:'synthetic-dancer'};
 const client={from(table){
  queries.push(table);assert.ok(['dancer_profiles','mydancr_tv_videos','admin_actions'].includes(table));
  let mutation=null,inserted=null,counted=false,active=false,filters={};
  const q={
   select(_columns,args){counted=Boolean(args?.head);return q;},eq(k,v){filters[k]=v;return q;},like(){return q;},in(){active=true;return q;},
   update(value){assert.equal(table,'mydancr_tv_videos');mutation=value;return q;},insert(value){assert.equal(table,'admin_actions');inserted=value;return q;},
   async maybeSingle(){assert.equal(table,'dancer_profiles');if(options.dancerFailure)return {data:null,error:{code:'08006',message:'private query details'}};return {data:options.missingDancer?null:dancer,error:null};},
   async single(){
    if(inserted){audits.push(inserted);if(options.auditThrow)throw new Error('private audit details');if(options.auditFailure)return {data:null,error:{code:'08006',message:'private audit details'}};return {data:options.auditMissing?null:{id:id(999)},error:null};}
    assert.ok(mutation);const row=rows.get(filters.id);assert.ok(row);
    if(row.status!==filters.status || row.submitted_by!==filters.submitted_by)return {data:null,error:{code:'PGRST116'}};
    if(options.markerFailureBefore)return {data:null,error:{code:'08006',message:'private marker details'}};
    Object.assign(row,mutation);
    if(options.markerThrow)throw new Error('private marker details');
    if(options.markerFailure)return {data:null,error:{code:'08006',message:'private marker details'}};
    const receipt={id:row.id,submitted_by:row.submitted_by,status:row.status,review_notes:row.review_notes};
    if(options.markerWrong)receipt[options.markerWrong]='wrong';
    return {data:options.markerMissing?null:receipt,error:null};
   },
   then(resolve,reject){return(async()=>{
    if(options.queryThrow)throw new Error('private query details');
    if(counted)return {count:options.batchCount===undefined?0:options.batchCount,data:null,error:options.batchFailure?{code:'08006'}:null};
    if(active)return {data:options.activeMissing?null:Array.from({length:options.activeCount||0},(_,i)=>({id:id(800+i)})),error:options.activeFailure?{code:'08006'}:null};
    // finalize read failure is deliberately asynchronous, to exercise the route catch boundary.
    throw new Error('private finalization details');
   })().then(resolve,reject);},
  };
  if(table==='mydancr_tv_videos')q.maybeSingle=async()=>{throw new Error('private finalization details');};
  return q;
 },get storage(){assert.fail('Preparation must never remove stored media');}};
 vm.runInNewContext(code,{exports:route,Error,Buffer,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon'}},console:{warn:(...args)=>warnings.push(args),info(){}},require(name){
  if(name==='crypto')return {timingSafeEqual};
  if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith('/api'))return {PublicApiError,apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}};
  if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject:r=>r.json()};
  if(name.endsWith('supabase/request'))return {async createRequestSupabaseContext(){if(options.noAuth)throw new PublicApiError('AUTH_REQUIRED','Sign in required.',401);return {client:{},user:{id:id(3)}};}};
  if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient(){adminClients++;return client;}};
  if(name.endsWith('/admin'))return {async requireAdmin(){if(options.notAdmin)throw new PublicApiError('FORBIDDEN','Admin access required.',403);}};
  if(name.endsWith('server-env'))return {getOptionalServerEnv:()=>key};
  if(name.endsWith('safe-error-metadata'))return {safeErrorMetadata};
  if(name.endsWith('/tv'))return {
   MYDANCR_TV_PROFILE_VIDEO_LIMIT:3,MYDANCR_TV_MAX_BYTES:75*1024*1024,MYDANCR_TV_MAX_DURATION_SECONDS:30,MYDANCR_TV_MIME_TYPES:new Set(['video/mp4','video/webm']),MYDANCR_TV_PROFILE_SLOT_STATUSES:['uploading','approved'],
   async createMyDancrTvUpload(_client,user,input){
    const n=created.length+1,videoId=id(n+100),path=user+'/'+dancer.id+'/'+videoId+'.'+(input.mimeType==='video/webm'?'webm':'mp4');
    const row={id:videoId,submitted_by:user,status:options.statusAfterCreate||'uploading',review_notes:'Preserve existing review'};rows.set(videoId,row);files.add(path);created.push(input);
    if(options.createFailureAt===n)throw new Error('private creation details');
    return {videoId,path,token:options.badToken?'':'synthetic-signed-token',uploadUrl:'https://synthetic.invalid/signed',...(options.foreignPath?{path:'foreign/private-path'}:{})};
   },
  };return {};
 }});
 return {rows,files,audits,warnings,queries,created,get adminClients(){return adminClients;},
  async post(extra={}){const response=await route.POST(new Request('https://example.invalid/import',{method:'POST',headers:{'content-type':'application/json','x-mydancr-media-import-key':options.badKey?'wrong':key},body:JSON.stringify({action:'prepare',dancerSlug:dancer.slug,batchId:'synthetic-batch',videos:[validVideo],...extra})}));return {response,body:await response.json()};},
 };
}
test('bulk replacement returns conflict before creating a privileged media client or touching existing videos',async()=>{const h=harness(),r=await h.post({replaceExisting:true});assert.equal(r.response.status,409);assert.match(r.body.error,/Bulk replacement/);assert.equal(h.adminClients,0);assert.equal(h.queries.length,0);assert.equal(h.created.length,0);});
test('successful append returns all prepared uploads after marker and audit acknowledgments',async()=>{const h=harness(),r=await h.post({videos:[validVideo,{...validVideo,mimeType:'video/webm',distributionScope:'feed_only'}]});assert.equal(r.response.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.uploads.length,2);assert.equal(r.body.replacedCount,0);assert.equal(h.audits.length,1);assert.equal(h.audits[0].admin_id,id(3));assert.equal(h.rows.size,2);assert.equal(h.files.size,2);assert.match(h.rows.get(id(101)).review_notes,/platform-import:synthetic-batch:1/);assert.equal(r.response.headers.get('cache-control'),'no-store');});
for(const option of ['markerFailureBefore','markerFailure','markerMissing','markerThrow','auditFailure','auditMissing','auditThrow'])test(option+' retains the prepared record and bytes without exposing credentials',async()=>{const h=harness({[option]:true}),r=await h.post();assert.equal(r.response.status,503);assert.equal(h.rows.size,1);assert.equal(h.files.size,1);assert.equal(h.warnings.length,1);assert.match(r.body.error,/review this batch before retrying/);assert.doesNotMatch(JSON.stringify([r.body,h.warnings]),/synthetic-signed-token|foreign\/private-path|private .*details/);assert.deepEqual(Array.from(h.warnings[0][1].preparedVideoIds),[id(101)]);});
for(const field of ['id','submitted_by','status','review_notes'])test('wrong '+field+' marker receipt cannot report prepared success',async()=>{const h=harness({markerWrong:field}),r=await h.post();assert.equal(r.response.status,503);assert.equal(h.rows.size,1);assert.equal(h.files.size,1);assert.equal(h.audits.length,0);});
for(const createFailureAt of [1,2])test('creation failure at '+createFailureAt+' preserves earlier and uncertain reservations',async()=>{const h=harness({createFailureAt}),r=await h.post({videos:[validVideo,validVideo]});assert.equal(r.response.status,503);assert.equal(h.rows.size,createFailureAt);assert.equal(h.files.size,createFailureAt);assert.equal(h.audits.length,0);});
for(const option of ['badToken','foreignPath'])test(option+' upload receipt is rejected without destructive cleanup',async()=>{const h=harness({[option]:true}),r=await h.post();assert.equal(r.response.status,503);assert.equal(h.rows.size,1);assert.equal(h.files.size,1);assert.equal(h.audits.length,0);});
test('a concurrent review is not overwritten by preparation metadata',async()=>{const h=harness({statusAfterCreate:'approved'}),r=await h.post();assert.equal(r.response.status,503);assert.equal(h.rows.get(id(101)).status,'approved');assert.equal(h.rows.get(id(101)).review_notes,'Preserve existing review');assert.equal(h.files.size,1);});
for(const batchCount of [null,-1,0.5])test('unconfirmed batch count '+batchCount+' does not reserve uploads',async()=>{const h=harness({batchCount}),r=await h.post();assert.equal(r.response.status,503);assert.equal(h.created.length,0);});
test('an existing prepared batch stops before creating more reservations',async()=>{const h=harness({batchCount:1}),r=await h.post();assert.equal(r.response.status,409);assert.equal(h.created.length,0);});
test('a missing library result is not treated as empty capacity',async()=>{const h=harness({activeMissing:true}),r=await h.post();assert.equal(r.response.status,503);assert.equal(h.created.length,0);});
test('full profile capacity returns conflict without recommending automatic deletion',async()=>{const h=harness({activeCount:3}),r=await h.post();assert.equal(r.response.status,409);assert.equal(h.created.length,0);assert.doesNotMatch(r.body.error,/replace|remove|delete/i);});
for(const option of ['dancerFailure','batchFailure','activeFailure','queryThrow'])test(option+' asynchronous error reaches the route response policy',async()=>{const h=harness({[option]:true}),r=await h.post();assert.ok(r.response.status>=500);assert.equal(r.body.ok,false);assert.equal(h.created.length,0);assert.doesNotMatch(JSON.stringify(r.body),/private/);});
test('an asynchronous finalization lookup error also reaches the route response policy',async()=>{const h=harness(),r=await h.post({action:'finalize',videoId:id(101)});assert.equal(r.response.status,500);assert.equal(r.body.ok,false);assert.doesNotMatch(JSON.stringify(r.body),/private/);});
for(const [option,status]of [['noAuth',401],['notAdmin',403],['badKey',403]])test(option+' denies access before media operations',async()=>{const h=harness({[option]:true}),r=await h.post();assert.equal(r.response.status,status);assert.equal(h.adminClients,0);assert.equal(h.created.length,0);});
