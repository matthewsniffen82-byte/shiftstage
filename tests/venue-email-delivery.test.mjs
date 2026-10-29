import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as prefs from '../src/lib/dancr/venue-notification-preferences.ts';
import * as customerPrefs from '../src/lib/dancr/customer-notification-preferences.ts';
const env={RESEND_API_KEY:'synthetic-key',EMAIL_FROM:'test@example.invalid'};
function compile(file,deps={},globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports,performance,AbortSignal,Response,Request,URL,URLSearchParams,console,process:{env},require:n=>deps[n]||{},...globals});return exports;
}
const plain=v=>JSON.parse(JSON.stringify(v));
const target={email:'owner@example.invalid',title:'Admin replied',body:'A saved <reply>',notification_type:'support_message',payload:{threadId:'thread',emailPath:'/dashboard/venue#venue-support'},metadata:{}};
function fixture({response=()=>Response.json({id:'provider-id'}),configured=true,allowed=true,receipt=true,targetError=false,emailTarget=target,now=Date.now()}={}){
 const requests=[],calls=[];let claimed=false;
 const service=compile('src/lib/dancr/venue-email-delivery.ts',{'./public-app-url':{publicAppUrl:()=> 'https://example.invalid'},'./venue-notification-preferences':prefs},
 {process:{env:configured?env:{}},Date:{parse:Date.parse,now:()=>now},fetch:async(url,init)=>{requests.push({url,init});return response();}});
 const client={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='claim_venue_emails'){const jobs=claimed?[]:[{id:'job-1',lease_id:'lease-1'}];claimed=true;return {data:jobs};}
  if(name==='venue_email_target')return targetError?{error:Error('database unavailable')}:{data:allowed?emailTarget:null};
  if(name==='finish_venue_email')return {data:receipt};return {data:null};
 }};return {service,requests,calls,run:()=>service.deliverVenueEmails(client)};
}
test('support mail uses the current verified destination, safe link and stable provider key',async()=>{
 const f=fixture();assert.equal((await f.run()).accepted,1);const {url,init}=f.requests[0];assert.equal(url,'https://api.resend.com/emails');assert.equal(init.redirect,'error');
 assert.equal(init.headers['Idempotency-Key'],'venue-email/job-1');const body=JSON.parse(init.body);assert.deepEqual(body.to,[target.email]);assert.match(body.html,/&lt;reply&gt;/);assert.match(body.text,/dashboard\/venue#venue-support/);
 assert.equal(f.calls.at(-2).args.p_provider_id,'provider-id');
});
test('provider outages, throttling and uncertain acceptance retain a retry receipt',async()=>{
 for(const response of [()=>new Response('',{status:429}),()=>new Response('',{status:503}),()=>{throw Error('timeout')},()=>Response.json({})]){
  const f=fixture({response});assert.equal((await f.run()).retry,1);assert.equal(f.calls.find(x=>x.name==='finish_venue_email').args.p_status,'retry');
 }
});
test('permanent provider rejection is recorded and never reported accepted',async()=>{
 const f=fixture({response:()=>new Response('',{status:403})});assert.equal((await f.run()).failed,1);assert.equal(f.calls.find(x=>x.name==='finish_venue_email').args.p_outcome,'provider_403');
});
test('missing provider configuration still prepares events but does not consume queued email',async()=>{
 const f=fixture({configured:false});const result=await f.run();assert.equal(result.configured,false);assert.deepEqual(f.calls.map(c=>c.name),['prepare_venue_email_alerts']);assert.equal(f.requests.length,0);
});
test('revoked access skips sends, target read errors retry, failed receipt acknowledgement throws',async()=>{
 const f=fixture({allowed:false});assert.equal((await f.run()).skipped,1);assert.equal(f.requests.length,0);
 assert.equal((await fixture({targetError:true}).run()).retry,1);
 await assert.rejects(fixture({receipt:false}).run(),/receipt/);
});
test('current alert and channel opt-outs apply to queued emails',async()=>{
 for(const key of ['alertsEnabled','supportReplies','emailEnabled']){
  const f=fixture();const result=await f.service.sendVenueEmail({id:'job'}, {...target,metadata:prefs.venueNotificationMetadataPatch({[key]:false})});assert.equal(result.status,'skipped');assert.equal(f.requests.length,0);
 }
});

test('queued checkout emails finish as skipped without contacting the email provider',async()=>{
 for(const reason of ['manual','venue_checkout','expired']){
  const f=fixture({emailTarget:{...target,payload:{kind:'venue_checkout_ended',reason},metadata:prefs.venueNotificationMetadataPatch({alertsEnabled:true,dancerActivity:true,emailEnabled:true})}});
  const result=await f.run();assert.equal(result.skipped,1);assert.equal(result.accepted,0);assert.equal(f.requests.length,0);
  assert.equal(f.calls.find(call=>call.name==='finish_venue_email').args.p_status,'skipped');
 }
});
test('weekly email retries stay inside Monday and cannot send stale or unscheduled summaries',async()=>{
 const weekly={...target,notification_type:'weekly_summary',payload:{kind:'venue_weekly_summary',weeklyScheduledFor:'2026-11-02T17:00:00Z',weeklySendBefore:'2026-11-03T08:00:00Z'}};
 for(const [at,status,outcome] of [
  ['2026-11-02T16:59:59Z','retry','weekly_not_due'],
  ['2026-11-02T17:00:00Z','accepted','provider_accepted'],
  ['2026-11-03T07:59:59Z','accepted','provider_accepted'],
  ['2026-11-03T08:00:00Z','skipped','weekly_window_closed'],
  ['2026-11-09T17:00:00Z','skipped','weekly_window_closed'],
 ]){
  const f=fixture({now:Date.parse(at)}),result=await f.service.sendVenueEmail({id:'weekly'},weekly);
  assert.equal(result.status,status,at);assert.equal(result.outcome,outcome);assert.equal(f.requests.length,status==='accepted'?1:0);
 }
 const f=fixture();const result=await f.service.sendVenueEmail({id:'legacy'},{...weekly,payload:{kind:'venue_weekly_summary'}});
 assert.equal(result.outcome,'weekly_schedule_missing');assert.equal(f.requests.length,0);
});
test('email links cannot be changed to external destinations',()=>{
 const f=fixture();for(const emailPath of ['https://attacker.invalid','//attacker.invalid','/dashboard/venue?token=private']){
  const content=f.service.venueEmailContent({...target,payload:{emailPath}});assert.match(content.text,/https:\/\/example.invalid\/dashboard\/venue$/);assert.doesNotMatch(content.text,/attacker|token/);
 }
});
test('review emails open the approval section, including previously queued notifications',()=>{
 const f=fixture();
 for(const emailPath of [undefined,'/dashboard/venue','/dashboard/venue#venue-publication']){
  const content=f.service.venueEmailContent({...target,payload:{event:'venue_page_review',emailPath}});
  assert.match(content.text,/Review your club page:\nhttps:\/\/example.invalid\/dashboard\/venue#venue-publication$/);
  assert.match(content.html,/href="https:\/\/example.invalid\/dashboard\/venue#venue-publication">Review your club page/);
 }
});
test('review push notifications and inline fallback emails link to the same approval section',async()=>{
 const pushes=[],emails=[];
 const client={rpc:async()=>({data:false}),auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:{}}}})}},from:()=>{
  const chain={select:()=>chain,in:()=>chain,eq:()=>chain,then:resolve=>Promise.resolve({data:[{id:'club',email:target.email,role:'venue'}]}).then(resolve)};return chain;
 }};
 const service=compile('src/lib/dancr/notification-delivery.ts',{'./venue-notification-preferences':prefs,'./customer-notification-preferences':customerPrefs,'./public-app-url':{publicAppUrl:()=> 'https://example.invalid'},'./web-push-delivery':{deliverWebPush:async(...args)=>{pushes.push(args);return true;}}},
 {fetch:async(_url,init)=>{emails.push(JSON.parse(init.body));return Response.json({id:'provider-id'});}});
 await service.deliverNotificationRows(client,[{...target,recipient_id:'club',notification_type:'approval_status',payload:{event:'venue_page_review'}}]);
 assert.match(JSON.stringify(pushes),/dashboard\/venue#venue-publication/);
 assert.match(JSON.stringify(emails),/dashboard\/venue#venue-publication/);
});
test('a persisted club notification is not also emailed inline, while table delivery remains independent',async()=>{
 const email=[],client={rpc:async()=>({data:true}),auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:{}}}})}},from:()=>{
  const chain={select:()=>chain,in:()=>chain,eq:()=>chain,then:resolve=>Promise.resolve({data:[{id:'club',email:target.email,role:'venue'}]}).then(resolve)};return chain;
 }};
 const service=compile('src/lib/dancr/notification-delivery.ts',{'./venue-notification-preferences':prefs,'./customer-notification-preferences':customerPrefs,'./public-app-url':{publicAppUrl:()=> 'https://example.invalid'},'./web-push-delivery':{deliverWebPush:async()=>true}},
 {fetch:async(_url,init)=>{email.push(init);return Response.json({id:'provider-id'});}});
 const row={...target,recipient_id:'club'};
 assert.deepEqual(plain(await service.deliverNotificationRows(client,[row])),{email:0,push:1});assert.equal(email.length,0);
 assert.deepEqual(plain(await service.deliverNotificationRows(client,[{...row,payload:{kind:'internal_table_request'},deliveryId:'table-job'}],{push:false})),{email:1,push:0});
});

test('checkout fallback delivery preserves push but never sends email; check-in email remains enabled',async()=>{
 const pushes=[],emails=[],client={rpc:async()=>({data:false}),auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:{}}}})}},from:()=>{
  const chain={select:()=>chain,in:()=>chain,eq:()=>chain,then:resolve=>Promise.resolve({data:[{id:'club',email:target.email,role:'venue'}]}).then(resolve)};return chain;
 }};
 const service=compile('src/lib/dancr/notification-delivery.ts',{'./venue-notification-preferences':prefs,'./customer-notification-preferences':customerPrefs,'./public-app-url':{publicAppUrl:()=> 'https://example.invalid'},'./web-push-delivery':{deliverWebPush:async(...args)=>{pushes.push(args);return true;}}},
 {fetch:async(_url,init)=>{emails.push(JSON.parse(init.body));return Response.json({id:'provider-id'});}});
 for(const payload of [{kind:'venue_checkout_ended'},{event:'venue_checkout_ended'}]){
  assert.deepEqual(plain(await service.deliverNotificationRows(client,[{...target,recipient_id:'club',payload}])),{email:0,push:1});
 }
 assert.equal(emails.length,0);assert.equal(pushes.length,2);
 assert.deepEqual(plain(await service.deliverNotificationRows(client,[{...target,recipient_id:'club',payload:{kind:'venue_checkin_started'}}])),{email:1,push:1});
 assert.equal(emails.length,1);
});
test('new operational events map to the intended preference switches',()=>{
 for(const [kind,key] of [['venue_guest_list_added','guestList'],['venue_media_pending','pageAndMedia'],['venue_dancer_approval_pending','pageAndMedia'],['venue_roster_changed','rosterChanges'],['venue_checkin_started','dancerActivity'],['venue_checkout_ended','dancerActivity']]){
  const row={notification_type:'support_message',payload:{kind}};assert.equal(prefs.venueNotificationCategory(row),key);assert.equal(prefs.venueNotificationEnabled({},row,'emailEnabled'),!kind.startsWith('venue_checkout_'));assert.equal(prefs.venueNotificationEnabled(prefs.venueNotificationMetadataPatch({[key]:false}),row,'emailEnabled'),false);
 }
});
