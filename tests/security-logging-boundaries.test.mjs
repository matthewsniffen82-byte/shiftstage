import assert from 'node:assert/strict';
import {readFileSync} from "./helpers/dashboard-test-fs.mjs";
import test from 'node:test';
import vm from 'node:vm';
import {createHmac, randomUUID} from 'node:crypto';
import ts from 'typescript';
import * as serverJobs from '../src/lib/server-job.ts';
import {withOpenAIRequestDeadline} from '../src/lib/openai-request.ts';
import * as workspacePolicy from '../src/lib/dancr/admin-workspace-policy.ts';
import * as photoSlots from '../src/lib/dancr/photo-slot.ts';
import {requireStorageUploadReceipt} from '../src/lib/dancr/storage-upload-receipt.ts';

const root = new URL('../', import.meta.url);
function source(file) { return readFileSync(new URL(file, root), 'utf8'); }
function load(file, {internals=[],dependencies={},globals={}}={}) {
  const exports={};
  const code=source(file)+'\n'+internals.map(name=>'exports.'+name+' = '+name+';').join('\n');
  vm.runInNewContext(ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports,Error,Headers,Date,URL,AbortController,Map,process:{env:{}},
    require:name=>Object.hasOwn(dependencies,name)?dependencies[name]
      :name==='../openai-request.ts'?{withOpenAIRequestDeadline}:name==='../server-job.ts'?serverJobs:{},...globals,
  });
  return exports;
}
const {safeErrorMetadata}=load('src/lib/security/safe-error-metadata.ts');
const privateValues=[
  'https://private.invalid/secret', '/srv/private/query.sql', 'C:\\private\\query.sql',
  'owner@example.invalid', 'Bearer synthetic-token', 'password=synthetic-secret',
  'code\nforged-event', 'code\rforged-event', 'x'.repeat(161),
];
const json=value=>JSON.parse(JSON.stringify(value));
for(const value of privateValues) for(const key of ['name','code','type','request_id']) {
  test('diagnostic field '+key+' rejects private or forged value '+privateValues.indexOf(value),()=>{
    assert.deepEqual(json(safeErrorMetadata({[key]:value})),{});
  });
}
test('operational diagnostic identifiers and bounded HTTP status survive',()=>{
  assert.deepEqual(json(safeErrorMetadata({name:'APIConnectionError',error:{code:'PGRST205',type:'provider_timeout'},response:{status:'503'},headers:new Headers({'x-request-id':'req_123-abc.456'})})),{
    errorName:'APIConnectionError',code:'PGRST205',type:'provider_timeout',status:503,requestId:'req_123-abc.456',
  });
});
for(const status of [Symbol('private'),{valueOf(){throw new Error('private');}},[503],true,0,600,Infinity,'5e2',' 503 ']) {
  test('logging does not coerce malformed status '+String(typeof status)+' '+String(status===Infinity?'infinite':typeof status==='object'?'object':status),()=>{
    assert.deepEqual(json(safeErrorMetadata({code:'timeout',status})),{code:'timeout'});
  });
}
for(const key of ['name','code','type','status','error','response','request_id','requestId','headers']) {
  test('diagnostic getter failure cannot interrupt error handling: '+key,()=>{
    const error={};Object.defineProperty(error,key,{get(){throw new Error('synthetic-private-getter');}});
    assert.deepEqual(json(safeErrorMetadata(error)),{});
  });
}
test('raw messages, stacks, bodies, causes, authorization and cookies never become diagnostics',()=>{
  const error=Object.assign(new Error('synthetic-private-message'),{code:'ETIMEDOUT',body:{token:'synthetic-private-body'},cause:{message:'synthetic-private-cause'},headers:{authorization:'secret',cookie:'secret'}});
  assert.deepEqual(json(safeErrorMetadata(error)),{errorName:'Error',code:'ETIMEDOUT'});
});
test('nested transport error codes remain useful without cause messages',()=>{
  assert.deepEqual(json(safeErrorMetadata({cause:{code:'ECONNRESET',message:'synthetic-private-cause'}})),{code:'ECONNRESET'});
  assert.deepEqual(json(safeErrorMetadata({cause:{code:'/srv/private/secret',message:'synthetic-private-cause'}})),{});
});
test('revoked diagnostic proxies cannot disrupt the error boundary',()=>{
  const {proxy,revoke}=Proxy.revocable({},{});revoke();
  assert.deepEqual(json(safeErrorMetadata(proxy)),{});
});
test('a failed provider header reader does not interrupt logging',()=>{
  const headers=new Headers();headers.get=()=>{throw new Error('synthetic-private-header');};
  assert.deepEqual(json(safeErrorMetadata({code:'ETIMEDOUT',headers})),{code:'ETIMEDOUT'});
});

for(const value of privateValues.slice(0,6)) test('video retry logging preserves bounded retry without provider text '+privateValues.indexOf(value),async()=>{
  const logs=[],delays=[];
  const {withVideoProviderRetry}=load('src/lib/dancr/video-moderation.ts',{
    internals:['withVideoProviderRetry'],dependencies:{'../security/safe-error-metadata':{safeErrorMetadata}},
    globals:{console:{warn:value=>logs.push(JSON.parse(value))},setTimeout:(callback,ms)=>{delays.push(ms);callback();}},
  });
  let attempts=0;
  const result=await withVideoProviderRetry(async()=>{if(++attempts===1)throw {status:503,code:value};return 'approved';},2);
  assert.equal(result,'approved');assert.equal(attempts,2);assert.deepEqual(delays,[350]);
  assert.deepEqual(logs,[{event:'mydancr_tv.frame_moderation_retry',frameNumber:3,nextAttempt:2,status:503}]);
});
for(const terminal of [false,true]) test('video retry classification and exhausted attempts remain unchanged '+terminal,async()=>{
  const logs=[],delays=[];const failure={status:terminal?400:503,code:'provider_timeout'};
  const {withVideoProviderRetry}=load('src/lib/dancr/video-moderation.ts',{
    internals:['withVideoProviderRetry'],dependencies:{'../security/safe-error-metadata':{safeErrorMetadata}},
    globals:{console:{warn:value=>logs.push(JSON.parse(value))},setTimeout:(callback,ms)=>{delays.push(ms);callback();}},
  });
  let attempts=0;await assert.rejects(withVideoProviderRetry(async()=>{attempts++;throw failure;},0),error=>error===failure);
  assert.equal(attempts,terminal?1:2);assert.equal(logs.length,terminal?0:1);assert.equal(delays.length,terminal?0:1);
});
for(const value of privateValues.slice(0,6)) test('optional saved venue count failure logs no dependency data '+privateValues.indexOf(value),async()=>{
  const logs=[];let cleared=false;
  const {getSavedVenueActivity}=load('src/lib/dancr/customer-venue-activity.ts',{
    dependencies:{'../security/safe-error-metadata.ts':{safeErrorMetadata}},globals:{console:{warn:(...args)=>logs.push(args)},setTimeout:()=>1,clearTimeout:()=>{cleared=true;}},
  });
  const result=await getSavedVenueActivity({from(){throw {code:value,message:value};}},['synthetic-venue']);
  assert.equal(result.size,0);assert.equal(cleared,true);assert.deepEqual(json(logs),[['CUSTOMER_VENUE_ACTIVITY_UNAVAILABLE',{}]]);
});
for(const value of privateValues.slice(0,6)) test('support notification failure preserves completed message and omits provider text '+privateValues.indexOf(value),async()=>{
  const logs=[];let attempts=0;
  const {deliverAtomicSupportNotifications}=load('src/lib/dancr/support.ts',{
    dependencies:{'../security/safe-error-metadata':{safeErrorMetadata},'./notification-delivery':{deliverNotificationRows:async()=>{attempts++;throw {code:value,name:value,message:value};}}},
    globals:{console:{error:(...args)=>logs.push(args)}},
  });
  const receipt={duplicate:false,notifications:[{id:'notification-1'}]};
  await deliverAtomicSupportNotifications({},receipt);
  assert.equal(attempts,1);assert.deepEqual(receipt,{duplicate:false,notifications:[{id:'notification-1'}]});
  assert.deepEqual(json(logs),[['SUPPORT_NOTIFICATION_DELIVERY_FAILED',{errorCode:'database_error'}]]);
  await deliverAtomicSupportNotifications({},{...receipt,duplicate:true});assert.equal(attempts,1);
});
test('profile debug logs retain counts without repeating private state or gallery identifiers',()=>{
  const dancer=source('src/lib/dancr/dancer.ts'),dashboard=source('app/dashboard/DashboardClient.tsx');
  for(const match of dancer.matchAll(/console\.log\("PROFILE_IMAGES_AFTER_SAVE", ([^\n]+)\);/g))assert.doesNotMatch(match[1],/dancerId|remainingPhotoIds/);
  assert.doesNotMatch(dashboard,/console\.log\("PUBLIC_PROFILE_STATE_BEFORE_RESET"/);
});
for(const requestId of ['req_valid-123',...privateValues.slice(0,6)]) test('queued photo preparation failure logs bounded diagnostics without private payload '+requestId,async()=>{
  const logs=[],work=[];let attempts=0;
  const {scheduleDancerPhotoReview}=load('src/lib/dancr/image-moderation.ts',{
    dependencies:{'../security/safe-error-metadata':{safeErrorMetadata}},
    globals:{console:{warn:(...args)=>logs.push(args)}},
  });
  const failure={request_id:requestId,code:'ETIMEDOUT',message:'synthetic-private-path',details:'synthetic-private-query',body:{token:'synthetic-private-token'}};
  const client={from(table){assert.equal(table,'image_moderation_records');attempts++;throw failure;}};
  scheduleDancerPhotoReview(client,{decision:'moderating',moderationRecordId:'record-1'},callback=>work.push(callback));
  assert.equal(work.length,1);assert.equal(attempts,0);
  await work[0]();assert.equal(attempts,1);
  assert.deepEqual(json(logs),[['IMAGE_MODERATION_BACKGROUND_FAILED',{recordId:'record-1',code:'ETIMEDOUT',...(requestId==='req_valid-123'?{requestId}:{})}]]);
  assert.doesNotMatch(JSON.stringify(logs),/synthetic-private|private\.invalid|owner@example|Bearer|password=/);
});
test('successful private photo preparation logs only its review receipt, not media or account details',async()=>{
  const logs=[],writes=[],copies=[];
  const {holdPhotoForClubReview}=load('src/lib/dancr/image-moderation.ts',{
    internals:['holdPhotoForClubReview'],
    dependencies:{
      crypto:{randomUUID},'./photo-slot':photoSlots,'./storage-upload-receipt':{requireStorageUploadReceipt},
      './responsive-image':{uploadResponsiveImage:async()=>({storagePath:'synthetic-private-display.jpg'})},
      './photo-publication':{updatePendingGalleryReview:async(_client,id,version,update)=>{writes.push({id,version,update});return {updated_at:'new-version'};}},
    },
    globals:{console:{info:value=>logs.push(JSON.parse(value))}},
  });
  const client={storage:{from:bucket=>({
    upload:async(path,bytes)=>{copies.push({bucket,path,bytes});return {data:{path},error:null};},
    remove:async()=>({error:null}),
  })}};
  const result=await holdPhotoForClubReview(client,{
    userId:'synthetic-private-user',profileId:'synthetic-private-profile',recordId:'record-1',expectedUpdatedAt:'version-1',
    tempPath:'synthetic-private-path.jpg',uploadContext:'profile_gallery:1',image:{buffer:Buffer.from('synthetic-private-image'),contentType:'image/jpeg'},
    evaluation:{decision:'review',reasonCodes:['human_review_required'],categoryScores:{},providerFlagged:false},categoryFlags:{file_checks_passed:true},
  });
  assert.equal(result.decision,'pending_review');assert.equal(result.photo.imageUrl,'');
  assert.equal(copies.length,1);assert.equal(writes.length,1);assert.equal(writes[0].update.status,'pending_review');
  assert.deepEqual(logs,[{event:'image_moderation.awaiting_club_review',recordId:'record-1',reviewMode:'human'}]);
  assert.doesNotMatch(JSON.stringify(logs),/synthetic-private/);
});
test('public discovery diagnostics omit raw request search values',()=>{
  const publicSource=source('src/lib/dancr/public.ts'),route=source('app/api/public/discovery/route.ts');
  for(const match of publicSource.matchAll(/console\.(?:log|warn)\([^;]+;/g))assert.doesNotMatch(match[0],/cityName|\bslug\b/);
  assert.doesNotMatch(route,/console\.error\("PUBLIC_DISCOVERY_LOAD_FAILED",\s*\{\s*city[,\s]/);
});
for(const account of [null,{role:'customer',account_state:'active'},{role:'admin',account_state:'disabled'},{role:'admin',account_state:'active',admin_workspace_role:'owner'}]) test('admin security event records denial without account identity '+JSON.stringify(account),async()=>{
  const logs=[];
  const {requireAdmin}=load('src/lib/dancr/admin.ts',{dependencies:{'./admin-workspace-policy':workspacePolicy},globals:{console:{warn:value=>logs.push(JSON.parse(value))}}});
  const query={select(){return this;},eq(){return this;},async maybeSingle(){return {data:account,error:null};}};
  const result=requireAdmin({from:()=>query},'synthetic-private-account');
  if(account?.role==='admin'&&account.account_state==='active'){await result;assert.deepEqual(logs,[]);}
  else {await assert.rejects(result,/Admin access required/);assert.deepEqual(logs,[{event:'security.admin_authorization_denied',accountFound:Boolean(account),activeAccount:account?.account_state==='active'}]);}
});
for(const allowed of [false,true]) test('rate-limit event preserves decision and retry time without subject or address '+allowed,async()=>{
  const logs=[];
  const {enforcePublicRequestRateLimit}=load('src/lib/dancr/public-request-rate-limit.ts',{
    dependencies:{'node:crypto':{createHmac},'../security/request-client-address':{requestClientAddress:()=> '192.0.2.12'}},
    globals:{console:{warn:value=>logs.push(JSON.parse(value))},process:{env:{DANCR_PUBLIC_RATE_LIMIT_SECRET:'synthetic-private-key'}}},
  });
  const result=enforcePublicRequestRateLimit({rpc:async()=>({data:{allowed,retry_after_seconds:61},error:null})},{namespace:'auth_login',request:{},subject:'owner@example.invalid',windowSeconds:300,ipLimit:10,subjectLimit:5});
  if(allowed){await result;assert.deepEqual(logs,[]);}
  else {await assert.rejects(result,error=>error.retryAfterSeconds===61);assert.deepEqual(logs,[{event:'security.rate_limit_exceeded',namespace:'auth_login',retryAfterSeconds:61}]);}
});
