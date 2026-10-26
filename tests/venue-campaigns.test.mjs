import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as content from '../src/lib/dancr/venue-campaign-content.ts';
import { followAlertKey, customerFollowAlertEnabled } from '../src/lib/dancr/customer-notification-preferences.ts';

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const token = 'a'.repeat(64), id = '97000000-0000-4000-8000-000000000050';
const items = [
  {campaignId:'one',venueId:'a',venueName:'Club A',subject:'Friday offer',address:'1 Main Street'},
  {campaignId:'two',venueId:'b',venueName:'Club B',subject:'Saturday event',address:'2 Main Street'},
];
const input = {id,email:'guest@example.test',token,items};
const config = {RESEND_API_KEY:'synthetic',EMAIL_FROM:'Updates <updates@example.test>',CRON_SECRET:'synthetic'};
function compile(path,overrides={},globals={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Request,Response,URL,Error,AbortSignal,performance,process:{env:config},setTimeout:fn=>{fn();return 1;},
     require:name=>overrides[name] ?? (name==='next/server'?require(name):{}),...globals});
  return exports;
}
function delivery(fetch,env=config,push=async()=>true) {
  return compile('src/lib/dancr/venue-campaign-delivery.ts',{
    './venue-campaign-content':content,
    './public-app-url':{publicAppUrl:()=> 'https://mydancr.com'},
    './web-push-config':{webPushConfig:()=> env.PUSH?{publicKey:'synthetic'}:null},
    './web-push-delivery':{deliverWebPush:push},
  },{fetch,process:{env}});
}
test('offers accept plain text but reject direct email/SMS, empty bodies and header injection',()=>{
  const valid={channel:'in_app',subject:' Tonight ',body:'Hello\r\nWelcome'};
  assert.deepEqual(content.normalizeCampaignInput(valid),{channel:'in_app',subject:'Tonight',body:'Hello\nWelcome'});
  assert.deepEqual(content.normalizeCampaignInput({channel:'in_app',subject:'Hi',body:'a'}),{channel:'in_app',subject:'Hi',body:'a'});
  for(const patch of [{channel:'email'},{channel:'text'},{body:''},{body:'x'.repeat(5001)},{subject:'Hello\r\nBcc: other@example.test'},{body:'\0'}])
    assert.throws(()=>content.normalizeCampaignInput({...valid,...patch}));
});
test('a single summary combines clubs, escapes HTML, links to Alerts and omits full offer bodies',()=>{
  const email=content.offerDigestEmail([...items,{...items[0],subject:'<script>x</script>',venueName:'A & B',body:'PRIVATE FULL BODY'}],'https://mydancr.com',token);
  assert.match(email.text,/Club A: Friday offer[\s\S]*Club B: Saturday event/);
  assert.match(email.html,/&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(email.html,/A &amp; B/);
  assert.doesNotMatch(email.html,/<script>|PRIVATE FULL BODY/);
  assert.match(email.text,/dashboard\/customer#customer-alerts/);
  assert.match(email.text,new RegExp('/email-preferences/'+token));
  const capped=content.offerDigestEmail(Array.from({length:23},()=>items[0]),'https://mydancr.com',token);
  assert.equal((capped.html.match(/<li>/g)||[]).length,20);
  assert.match(capped.text,/Plus 3 more in Alerts/);
});
test('Resend gets one recipient, stable idempotency and both unsubscribe formats',async()=>{
  const calls=[];const api=delivery(async(url,init)=>{calls.push({url,init});return Response.json({id:'email-id'});});
  assert.equal((await api.sendOfferDigest(input)).status,'accepted');
  const message=JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url,'https://api.resend.com/emails');
  assert.deepEqual(message.to,['guest@example.test']);assert.equal(message.bcc,undefined);
  assert.equal(calls[0].init.headers['Idempotency-Key'],'club-offer-digest/'+id);
  assert.match(message.headers['List-Unsubscribe'],/api\/public\/customer-email\?token=/);
  assert.equal(message.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  await api.sendOfferDigest(input);
  assert.equal(calls[1].init.body,calls[0].init.body);
  assert.equal(calls[1].init.headers['Idempotency-Key'],calls[0].init.headers['Idempotency-Key']);
});
test('missing configuration and invalid targets never call the provider',async()=>{
  let calls=0;const fetch=async()=>{calls++;return Response.json({id:'test'});};
  assert.equal((await delivery(fetch,{}).sendOfferDigest(input)).status,'retry');
  for(const patch of [{token:'bad'},{items:[]}]) assert.equal((await delivery(fetch).sendOfferDigest({...input,...patch})).status,'skipped');
  assert.equal(calls,0);assert.equal(delivery(fetch,{}).campaignChannels().in_app,true);
});
test('transient and uncertain provider outcomes retry with the same identity; permanent rejection fails',async()=>{
  for(const status of [429,500,503]) assert.equal((await delivery(async()=>new Response('',{status})).sendOfferDigest(input)).status,'retry');
  assert.equal((await delivery(async()=>new Response('',{status:422})).sendOfferDigest(input)).status,'failed');
  assert.equal((await delivery(async()=>Response.json({})).sendOfferDigest(input)).status,'retry');
  assert.equal((await delivery(async()=>{throw new Error('timeout');}).sendOfferDigest(input)).status,'retry');
});
function workerFixture({target=true,readError=false,receipt=true,withPush=false,pushTarget=true}={}) {
  const calls=[],sent=[],pushes=[];let digestClaimed=false,pushClaimed=false;
  const admin={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='claim_club_offer_digests'){if(digestClaimed)return {data:[]};digestClaimed=true;return {data:[{id,lease_id:'digest-lease'}]};}
    if(name==='claim_venue_offer_push'){if(pushClaimed)return {data:[]};pushClaimed=true;return {data:[{id:'push-job',lease_id:'push-lease'}]};}
    if(name==='club_offer_digest_target')return readError?{error:new Error('database unavailable')}:{data:target?input:null};
    if(name==='venue_offer_push_target')return {data:pushTarget?{userId:'customer',notificationId:'notice',venueName:'Club A'}:null};
    return {data:receipt};
  }};
  const api=delivery(async(url,init)=>{sent.push({url,init});return Response.json({id:'accepted'});},
    {...config,...(withPush?{PUSH:'yes'}:{})},async(...args)=>{pushes.push(args);return true;});
  return {run:()=>api.deliverVenueCampaigns(admin),calls,sent,pushes};
}
test('worker rechecks the claimed digest before sending and records its exact lease receipt',async()=>{
  const f=workerFixture();const counts=await f.run();
  assert.equal(f.sent.length,1);assert.equal(counts.emailAccepted,1);
  const target=f.calls.find(x=>x.name==='club_offer_digest_target');
  assert.deepEqual(plain(target.args),{p_id:id,p_lease:'digest-lease'});
  const finish=f.calls.find(x=>x.name==='finish_club_offer_digest');
  assert.equal(finish.args.p_status,'accepted');assert.equal(finish.args.p_provider_id,'accepted');
  assert.equal(finish.args.p_lease,'digest-lease');
});
test('changed preferences skip and failed preference reads retry without contacting Resend',async()=>{
  for(const options of [{target:false},{readError:true}]) {
    const f=workerFixture(options);await f.run();assert.equal(f.sent.length,0);
    const result=f.calls.find(x=>x.name==='finish_club_offer_digest').args;
    assert.equal(result.p_status,options.readError?'retry':'skipped');
  }
});
test('a missing receipt fails the worker so it cannot claim delivery was recorded',async()=>{
  await assert.rejects(workerFixture({receipt:false}).run(),/receipt unavailable/);
});
test('push uses a stable notice identity and generic text, with fresh permission checks',async()=>{
  const f=workerFixture({withPush:true});const counts=await f.run();
  assert.equal(f.pushes.length,1);assert.equal(counts.pushAccepted,1);
  assert.equal(f.pushes[0][1],'customer');assert.equal(f.pushes[0][3],'notice');
  assert.match(f.pushes[0][2].url,/dashboard\/customer#customer-alerts/);
  assert.doesNotMatch(f.pushes[0][2].body,/Friday offer|Main Street/);
  const blocked=workerFixture({withPush:true,pushTarget:false});await blocked.run();
  assert.equal(blocked.pushes.length,0);
  assert.equal(blocked.calls.find(x=>x.name==='finish_venue_offer_push').args.p_status,'skipped');
});
test('club offers use the existing club and master switches',()=>{
  assert.equal(followAlertKey('club_offer'),'clubDeals');
  assert.equal(customerFollowAlertEnabled({clubDeals:false},'clubDeals'),false);
  assert.equal(customerFollowAlertEnabled({followAlertsEnabled:false},'clubDeals'),false);
});
function routeFixture({role='owner',mutationAllowed=true}={}) {
  const calls=[];
  const campaign={id,body:'Full offer',published_count:2};
  const query={};for(const name of ['select','eq','neq','order','limit'])query[name]=(...args)=>{calls.push({name,args});return query;};
  query.then=resolve=>resolve({data:[]});query.single=async()=>({data:campaign});
  class PublicApiError extends Error {constructor(code,message,status){super(message);this.status=status;}}
  const route=compile('app/api/venue/campaigns/route.ts',{
    '@/src/lib/api':{PublicApiError,apiError:error=>Response.json({error:error.message},{status:error.status||500})},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({user:{id:'owner'},session:{accessToken:'rotated'}})},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({rpc:async(name,args,options)=>{calls.push({name,args,options});return {data:[],count:2};},from:()=>query})},
    '@/src/lib/dancr/venue-access':{getVenueAccess:async()=>({role,venueId:'own-club',venueName:'Club A'})},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject:request=>request.json()},
    '@/src/lib/security/browser-mutation':{requireSameOriginJsonMutation:()=>{if(!mutationAllowed)throw new PublicApiError('FORBIDDEN','Origin denied',403);}},
    '@/src/lib/dancr/venue-campaign-delivery':{campaignChannels:()=>({in_app:true,email:true,push:true})},
    '@/src/lib/dancr/venue-campaign-content':content,
  });
  const post=body=>route.POST(new Request('https://mydancr.com/api/venue/campaigns',{method:'POST',body:JSON.stringify({id,...body})}));
  return {...route,post,calls};
}
test('route binds previews to the verified club and actor, ignoring client-supplied recipients',async()=>{
  const f=routeFixture();const response=await f.post({action:'preview',channel:'in_app',subject:'Offer',body:'Message',venueId:'other-club',actor:'other-user',recipients:['outsider']});
  assert.equal(response.status,200);
  const call=f.calls.find(x=>x.name==='prepare_venue_update_campaign');
  assert.equal(call.args.p_venue,'own-club');assert.equal(call.args.p_actor,'owner');
  assert.equal(call.args.recipients,undefined);
  assert.equal((await response.json()).preview,'Full offer');
});
test('staff and cross-origin writes are denied; direct email and invalid actions never publish',async()=>{
  for(const options of [{role:'staff'},{mutationAllowed:false}]) {
    const f=routeFixture(options);assert.equal((await f.post({action:'send'})).status,403);
    assert.equal(f.calls.length,0);
  }
  for(const data of [{action:'preview',channel:'email',subject:'No',body:'No'},{action:'delete'},{action:'send',id:'invalid'}]) {
    const f=routeFixture();assert.equal((await f.post(data)).status,400);
    assert.ok(!f.calls.some(x=>x.name==='set_venue_update_campaign_state'));
  }
});
test('audience preview exposes a count, not follower IDs or email addresses',async()=>{
  const f=routeFixture();const response=await f.GET(new Request('https://mydancr.com/api/venue/campaigns'));
  const body=await response.json();assert.equal(body.counts.in_app,2);
  const call=f.calls.find(x=>x.name==='venue_offer_audience');
  assert.deepEqual(plain(call.options),{count:'exact',head:true});
  assert.equal(body.recipients,undefined);
  assert.ok(f.calls.some(x=>x.name==='eq'&&x.args[0]==='venue_id'&&x.args[1]==='own-club'));
});
