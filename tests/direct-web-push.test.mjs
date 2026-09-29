import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createECDH, randomBytes, createHash } from 'node:crypto';
import webPush from 'web-push';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
const require = createRequire(import.meta.url);
const pair = webPush.generateVAPIDKeys();
const env = { WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey, WEB_PUSH_VAPID_SUBJECT: 'https://mydancr.com' };
function compile(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file, import.meta.url),'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true } }).outputText, {
    exports, Buffer, URL, Request, Response, Uint8Array, AbortSignal, process:{env}, console:{warn(){}},
    require:name=>dependencies[name] ?? (name === 'server-only' ? {} : require(name)), ...globals,
  }); return exports;
}
const config = compile('src/lib/dancr/web-push-config.ts');
const validation = compile('src/lib/dancr/web-push-subscriptions.ts', {'../api-error-policy':{PublicApiError}});
const capability = compile('src/lib/dancr/customer-notification-delivery.ts', {'./web-push-config':config});
const receiver=createECDH('prime256v1');receiver.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-device',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
const device = {endpoint_hash:validation.webPushEndpointHash(subscription.endpoint),endpoint:subscription.endpoint,...subscription.keys};
const own='10000000-0000-4000-8000-000000000001';
const deliveryId='20000000-0000-4000-8000-000000000001';

test('capability exposes only a valid public VAPID key, never the signing key or an enrollment alias',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(capability.notificationPushDelivery(own))),{pushAvailable:true,pushPublicKey:pair.publicKey});
  for(const patch of [{WEB_PUSH_VAPID_PRIVATE_KEY:''},{WEB_PUSH_VAPID_PUBLIC_KEY:webPush.generateVAPIDKeys().publicKey},{WEB_PUSH_VAPID_SUBJECT:'file:///private'}]) {
    assert.equal(compile('src/lib/dancr/web-push-config.ts',{}, {process:{env:{...env,...patch}}}).webPushConfig(),null);
  }
});
test('subscriptions validate encryption keys and accept only HTTPS browser push services',()=>{
  assert.equal(validation.webPushSubscription(subscription).endpoint,subscription.endpoint);
  for(const endpoint of ['http://fcm.googleapis.com/fcm/send/x','https://127.0.0.1/push','https://[::1]/push','https://fcm.googleapis.com.evil.test/push','https://fcm.googleapis.com:8443/push','https://user:pass@fcm.googleapis.com/push','https://example.com/push','https://web.push.apple.com/push#secret']) assert.throws(()=>validation.webPushSubscription({...subscription,endpoint}));
  for(const keys of [{...subscription.keys,auth:'bad'},{...subscription.keys,p256dh:Buffer.alloc(65).toString('base64url')}]) assert.throws(()=>validation.webPushSubscription({...subscription,keys}));
  for(const host of ['web.push.apple.com','updates.push.services.mozilla.com','db5p.notify.windows.com']) assert.ok(validation.webPushEndpoint('https://'+host+'/push/subscription'));
});

function deliveryFixture({devices=[device],status=201,receipts=[],saveError=false}={}) {
  const calls=[],writes=[];
  const client={from(table){let filters=[],operation='select',values;return {
    select(){return this},eq(key,value){filters.push([key,value]);return this},limit(){return this},delete(){operation='delete';return this},
    upsert(value){operation='upsert';values=value;return this},
    then(resolve){if(operation!=='select')writes.push({table,operation,filters,values});
      if(table==='web_push_subscriptions'&&operation==='select')assert.ok(filters.some(([key,value])=>key==='user_id'&&value===own));
      return Promise.resolve({data:operation==='select'?(table==='web_push_subscriptions'?devices:receipts):null,error:saveError&&operation==='upsert'?Error('receipt unavailable'):null}).then(resolve)}
  }}};
  const service=compile('src/lib/dancr/web-push-delivery.ts',{'./web-push-config':config,'./web-push-subscriptions':validation},{fetch:async(url,init)=>{calls.push({url,init});return new Response(null,{status:typeof status==='function'?status(url):status})}});
  return {calls,writes,run:()=>service.deliverWebPush(client,own,{title:'MyDancr Internal',body:'Table 12 wants Aster.',url:'https://mydancr.com/dashboard/venue#table-requests',ttl:60},deliveryId)};
}
test('direct delivery encrypts content, signs VAPID, preserves short TTL and records acceptance',async()=>{
  const f=deliveryFixture();assert.equal(await f.run(),true);assert.equal(f.calls.length,1);
  const request=f.calls[0];assert.equal(request.url,subscription.endpoint);assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.TTL,60);
  assert.equal(request.init.headers['Content-Encoding'],'aes128gcm');assert.match(request.init.headers.Authorization,/^vapid /);
  assert.doesNotMatch(Buffer.from(request.init.body).toString('utf8'),/Table 12|Aster|10000000|mydancr.com/);
  assert.ok(request.init.signal);assert.equal(f.writes[0].values.delivery_id,deliveryId);
});
test('accepted devices are not replayed when a queue job retries',async()=>{
  const f=deliveryFixture({receipts:[{endpoint_hash:device.endpoint_hash}]});assert.equal(await f.run(),true);assert.equal(f.calls.length,0);
});
for(const status of [404,410])test('expired device '+status+' is deleted only for the recipient',async()=>{
  const f=deliveryFixture({status});assert.equal(await f.run(),false);assert.equal(f.writes[0].operation,'delete');assert.ok(f.writes[0].filters.some(([key,value])=>key==='user_id'&&value===own));
});
test('one failed device keeps the job retryable while successful devices receive receipts',async()=>{
  const other={...device,endpoint:device.endpoint+'-second',endpoint_hash:'b'.repeat(64)};
  const f=deliveryFixture({devices:[device,other],status:url=>url.endsWith('second')?503:201});
  assert.equal(await f.run(),false);assert.equal(f.writes.filter(x=>x.operation==='upsert').length,1);
  assert.equal(await deliveryFixture({saveError:true}).run(),false);
});
test('a stored invalid endpoint is never contacted',async()=>{
  const f=deliveryFixture({devices:[{...device,endpoint:'https://127.0.0.1/admin'}]});assert.equal(await f.run(),false);assert.equal(f.calls.length,0);
});

function apiFixture({authenticated=true,saved=true}={}) {
  const calls=[];
  const admin={rpc:async(name,args)=>{calls.push({name,args});return {data:saved}},from(table){const filters=[];return {select(){return this},eq(key,value){filters.push([key,value]);return this},limit(){return this},delete(){return this},then(resolve){calls.push({table,filters});return Promise.resolve({data:[{endpoint_hash:device.endpoint_hash}]}).then(resolve)}}}};
  const route=compile('app/api/push/subscriptions/route.ts',{
    'next/server':{NextResponse:{json:Response.json}},'@/src/lib/api':{apiError:(error,message)=>{const result=resolveApiError(error,message);return Response.json(result.body,{status:result.status})}},
    '@/src/lib/api-error-policy':{PublicApiError},'@/src/lib/bounded-json-body':{readBoundedJsonObject:request=>request.json()},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(_request,access)=>{assert.equal(access.active,true);if(!authenticated)throw new PublicApiError('AUTH_REQUIRED','Sign in required.',401);return {user:{id:own}}}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/src/lib/dancr/web-push-config':config,'@/src/lib/dancr/web-push-subscriptions':validation,
    '@/src/lib/dancr/public-request-rate-limit':{enforcePublicRequestRateLimit:async(_client,input)=>{assert.equal(input.subject,own);calls.push({rateLimited:true})},PublicRequestRateLimitError:class extends Error{}},
  });return {...route,calls};
}
const request=(method,body,origin='https://mydancr.com')=>new Request('https://mydancr.com/api/push/subscriptions',{method,headers:{origin},...(body?{body:JSON.stringify(body)}:{})});
test('device registration uses the verified caller and ignores forged recipient fields',async()=>{
  const f=apiFixture();const response=await f.POST(request('POST',{subscription,publicKey:pair.publicKey,userId:'other',role:'admin'}));assert.equal(response.status,200);
  assert.equal(f.calls.find(c=>c.args).args.p_user_id,own);assert.match(response.headers.get('cache-control'),/private.*no-store/);
  const body=await response.json();assert.equal(body.subscriptionId,device.endpoint_hash);assert.doesNotMatch(JSON.stringify(body),/endpoint|p256dh|privateKey/);
});
test('subscription reads and deletion are scoped to the caller; unauthenticated and cross-origin writes fail',async()=>{
  const f=apiFixture();const read=await f.GET(request('GET'));assert.deepEqual((await read.json()).subscriptionIds,[device.endpoint_hash]);
  assert.equal((await f.DELETE(request('DELETE',{endpoint:subscription.endpoint,userId:'other'}))).status,200);
  for(const c of f.calls.filter(c=>c.filters))assert.ok(c.filters.some(([key,value])=>key==='user_id'&&value===own));
  const denied=apiFixture({authenticated:false});assert.equal((await denied.POST(request('POST',{}))).status,401);assert.equal(denied.calls.length,0);
  const crossed=apiFixture();assert.equal((await crossed.POST(request('POST',{},'https://evil.test'))).status,403);assert.equal(crossed.calls.length,0);
  assert.equal((await apiFixture().POST(request('POST',{subscription,publicKey:'old-key'}))).status,409);
  assert.equal((await apiFixture({saved:false}).POST(request('POST',{subscription,publicKey:pair.publicKey}))).status,409);
});
