import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
function source(file) { return readFileSync(new URL(file, root), 'utf8'); }
function load(file, {internals=[],dependencies={},globals={}}={}) {
  const exports={};
  const code=source(file)+'\n'+internals.map(name=>'exports.'+name+' = '+name+';').join('\n');
  vm.runInNewContext(ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports,Error,Headers,Date,URL,AbortController,Map,process:{env:{}},
    require:name=>Object.hasOwn(dependencies,name)?dependencies[name]:{},...globals,
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
for(const [type,length,expectedType,expectedLength] of [
  ['image/jpeg; private=synthetic-secret','123','image/jpeg',123],
  ['image/owner@example.invalid','synthetic-secret',undefined,undefined],
  ['image/png','9999999999999999','image/png',undefined],
]) test('image probe logs normalize response headers '+type,async()=>{
  const logs=[];
  const {probeSignedImageUrl}=load('src/lib/dancr/image-moderation.ts',{
    internals:['probeSignedImageUrl'],dependencies:{'../security/safe-error-metadata':{safeErrorMetadata}},
    globals:{console:{log:(...args)=>logs.push(args),info:value=>logs.push(JSON.parse(value))},fetch:async()=>({status:200,ok:true,headers:new Headers({'content-type':type,'content-length':length})})},
  });
  await probeSignedImageUrl('https://storage.example.invalid/private-signed-object','private/path');
  assert.equal(logs.length,3);
  for(const entry of logs){const data=Array.isArray(entry)?entry[1]:entry;assert.equal(data.contentType,expectedType);if('contentLength' in data)assert.equal(data.contentLength,expectedLength);}
  assert.doesNotMatch(JSON.stringify(logs),/synthetic-secret|owner@example|private-signed|private\/path/);
});
test('profile debug logs retain counts without repeating private state or gallery identifiers',()=>{
  const dancer=source('src/lib/dancr/dancer.ts'),dashboard=source('app/dashboard/DashboardClient.tsx');
  for(const match of dancer.matchAll(/console\.log\("PROFILE_IMAGES_AFTER_SAVE", ([^\n]+)\);/g))assert.doesNotMatch(match[1],/dancerId|remainingPhotoIds/);
  assert.doesNotMatch(dashboard,/console\.log\("PUBLIC_PROFILE_STATE_BEFORE_RESET"/);
});
for(const requestId of ['req_valid-123',...privateValues.slice(0,6)]) test('successful moderation logs retain receipt identifiers without provider payload '+requestId,async()=>{
  const logs=[],requests=[];
  const providerResult={flagged:false,categories:{'synthetic-private-category':'synthetic-private-value'},category_scores:{'synthetic-private-score':'synthetic-private-value'}};
  const {moderateImageWithOpenAI}=load('src/lib/dancr/image-moderation.ts',{
    dependencies:{'../security/safe-error-metadata':{safeErrorMetadata},'../openai-client':{createOpenAIClient:async()=>({moderations:{create:async request=>{requests.push(request);return {_request_id:requestId,results:[typeof request.input==='string'?{flagged:'synthetic-private-flag'}:providerResult]};}}})},'../server-env':{getServerEnv:()=> 'synthetic-key'}},
    globals:{process:{env:{OPENAI_API_KEY:'synthetic-key'}},console:{log:(...args)=>logs.push(args),info:value=>logs.push(JSON.parse(value))},setTimeout:()=>1,clearTimeout:()=>{},fetch:async()=>({status:200,ok:true,headers:new Headers({'content-type':'image/jpeg'})})},
  });
  const client={storage:{from:()=>({download:async()=>({data:{type:'image/jpeg',size:123},error:null}),createSignedUrl:async()=>({data:{signedUrl:'https://storage.example.invalid/synthetic-private-object'},error:null})})}};
  assert.equal(await moderateImageWithOpenAI(client,'synthetic-private-path'),providerResult);
  assert.equal(requests.length,2);assert.equal(requests[0].input,'A normal profile photo');
  assert.doesNotMatch(JSON.stringify(logs),/synthetic-private|private\.invalid|owner@example|Bearer|password=/);
  const receiptLogs=logs.filter(entry=>Array.isArray(entry)&&['OPENAI_TEXT_TEST','OPENAI_MODERATION_RESULT','OPENAI_IMAGE_MODERATION_RESULT'].includes(entry[0]));
  assert.equal(receiptLogs.length,3);
  for(const entry of receiptLogs)assert.equal(entry[1].requestId,requestId==='req_valid-123'?requestId:undefined);
  assert.ok(logs.some(entry=>entry.event==='image_moderation.moderation_completed'&&entry.categoryCount===1));
});
test('public discovery diagnostics omit raw request search values',()=>{
  const publicSource=source('src/lib/dancr/public.ts'),route=source('app/api/public/discovery/route.ts');
  for(const match of publicSource.matchAll(/console\.(?:log|warn)\([^;]+;/g))assert.doesNotMatch(match[0],/cityName|\bslug\b/);
  assert.doesNotMatch(route,/console\.error\("PUBLIC_DISCOVERY_LOAD_FAILED",\s*\{\s*city[,\s]/);
});
for(const account of [null,{role:'customer',account_state:'active'},{role:'admin',account_state:'disabled'},{role:'admin',account_state:'active'}]) test('admin security event records denial without account identity '+JSON.stringify(account),async()=>{
  const logs=[];
  const {requireAdmin}=load('src/lib/dancr/admin.ts',{globals:{console:{warn:value=>logs.push(JSON.parse(value))}}});
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
