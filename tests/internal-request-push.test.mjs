import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { timingSafeEqual } from 'node:crypto';
import { venueNotificationSettings, venueNotificationMetadataPatch, venueNotificationCategory } from '../src/lib/dancr/venue-notification-preferences.ts';

function fixture({available=true,preferences={pushEnabled:true},sent=1,fail=false}={}){
  const calls=[], deliveries=[], service={};
  const jobs=[{id:'delivery-uuid',lease_id:'lease-uuid',recipient_id:'host-user',table_label:'Table 12',stage_name:'Aster'}];
  const source=ts.transpileModule(readFileSync(new URL('../src/lib/dancr/internal-request-push.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(source,{exports:service,console:{warn(){}},require:name=>({
    'server-only':{},'./venue-notification-preferences':{venueNotificationSettings},
    './customer-notification-delivery':{notificationPushDelivery:()=>({pushAvailable:available})},
    './notification-delivery':{deliverNotificationRows:async(_client,rows,options)=>{deliveries.push({rows,options});if(fail)throw Error('provider down');return {push:sent};}},
  }[name])});
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_internal_request_push'?jobs:true,error:null};},auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:venueNotificationMetadataPatch(preferences)}},error:null})}}};
  return {calls,deliveries,run:()=>service.deliverInternalRequestPush(client,'request-uuid')};
}
test('table request targets the scoped staff recipient with exact table/dancer copy and no email',async()=>{
  const f=fixture();assert.equal((await f.run()).sent,1);
  const {rows,options}=f.deliveries[0];assert.equal(options.email,false);assert.equal(rows[0].body,'Table 12 wants Aster.');
  assert.equal(rows[0].deliveryId,'delivery-uuid');assert.equal(rows[0].recipient_id,'host-user');
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0].payload)),{kind:'internal_table_request'});
  assert.equal(f.calls[0].args.p_request_id,'request-uuid');
});
for(const key of ['pushEnabled','tableRequests','alertsEnabled'])test(key+' opt-out suppresses delivery',async()=>{
  const f=fixture({preferences:{pushEnabled:true,[key]:false}});assert.equal((await f.run()).skipped,1);assert.equal(f.deliveries.length,0);
});
test('missing configuration preserves pending jobs',async()=>{const f=fixture({available:false});assert.equal((await f.run()).configured,false);assert.equal(f.calls.length,0);});
for(const options of [{sent:0},{fail:true}])test('unconfirmed provider delivery schedules a retry',async()=>{
  const f=fixture(options);assert.equal((await f.run()).retry,1);assert.equal(f.calls.at(-1).args.p_outcome,'retry');
});
test('table requests have their own venue preference instead of support or activity settings',()=>{
  assert.equal(venueNotificationCategory({notification_type:'support_message',payload:{kind:'internal_table_request'}}),'tableRequests');
  assert.equal(venueNotificationSettings({}).tableRequests,true);assert.equal(venueNotificationSettings({}).pushEnabled,false);
});

test('scheduled delivery requires the cron secret and reports missing provider configuration',async()=>{
  const auth={},route={};let invoked=0,configured=false;
  const compile=path=>ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(compile('src/lib/dancr/cron-auth.ts'),{exports:auth,Buffer,process:{env:{CRON_SECRET:'synthetic-worker-secret'}},require:name=>({'server-only':{},'node:crypto':{timingSafeEqual},'next/server':{NextResponse:{json:Response.json}}}[name])});
  vm.runInNewContext(compile('app/api/cron/internal-request-push/route.ts'),{exports:route,console:{warn(){}},require:name=>{
    if(name==='next/server')return {NextResponse:{json:Response.json}};
    if(name.endsWith('cron-auth'))return auth;
    if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>({})};
    if(name.endsWith('internal-request-push'))return {deliverInternalRequestPush:async()=>{invoked++;return {configured,sent:0,skipped:0,retry:0};}};
    throw Error(name);
  }});
  for(const authorization of ['', 'Bearer wrong'])assert.equal((await route.GET(new Request('https://example.test/worker',{headers:{authorization}}))).status,401);
  assert.equal(invoked,0);
  const request=()=>new Request('https://example.test/worker',{headers:{authorization:'Bearer synthetic-worker-secret'}});
  assert.equal((await route.GET(request())).status,503);
  configured=true;
  const response=await route.GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(invoked,2);
});
