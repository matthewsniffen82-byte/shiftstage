import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import ts from 'typescript';
import { normalizeVenueUpdateChoices, readVenueUpdateChoices, VENUE_UPDATE_CONSENT_VERSION } from '../src/lib/dancr/venue-update-preferences.ts';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { requireSameOriginJsonMutation } from '../src/lib/security/browser-mutation.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
function load(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,Map,Set,require:name=>{assert.ok(name in imports,name);return imports[name];}});return exports;}
const opts={email:true,text:false,version:VENUE_UPDATE_CONSENT_VERSION},token='a'.repeat(43);

test('an unchecked marketing form creates no opt-in and each selected channel stays separate',()=>{
  const form=new FormData();
  form.set('guestConsent','on');form.set('email','guest@example.test');
  assert.equal(readVenueUpdateChoices(form),undefined);
  form.set('emailUpdates','on');
  assert.deepEqual(readVenueUpdateChoices(form),opts);
  form.delete('emailUpdates');form.set('textUpdates','on');
  assert.deepEqual(readVenueUpdateChoices(form),{email:false,text:true,version:VENUE_UPDATE_CONSENT_VERSION});
});

test('update permission requires strict separate choices, current wording and the selected contact address',()=>{
  for(const invalid of [null,{},true,{...opts,email:'true'},{...opts,text:1},{...opts,version:'old'}])assert.equal(normalizeVenueUpdateChoices(invalid,'guest@example.test'),null);
  assert.equal(normalizeVenueUpdateChoices(opts,''),null);
  assert.deepEqual(normalizeVenueUpdateChoices({...opts,email:false,text:true},''),{email:false,text:true,version:VENUE_UPDATE_CONSENT_VERSION});
});

test('recording skips unselected channels, uses server-generated management tokens and rejects incomplete receipts',async()=>{
  const helper=load('src/lib/dancr/venue-update-opt-ins.ts',{'server-only':{},'node:crypto':{randomBytes}}),calls=[];
  const admin={rpc:async(name,args)=>{calls.push({name,args});return {data:[{channel:'email',token,active:true}]};}};
  assert.equal((await helper.recordVenueUpdateOptIns(admin,'ride','receipt')).length,0);assert.equal(calls.length,0);
  const result=await helper.recordVenueUpdateOptIns(admin,'ride','receipt',opts);
  assert.equal(result[0].manageUrl,'/updates/'+token);assert.equal(calls[0].args.p_receipt,'receipt');assert.equal(calls[0].args.p_text,false);
  assert.match(calls[0].args.p_email_token,/^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(helper.recordVenueUpdateOptIns({rpc:async()=>({error:new Error('DB unavailable')})},'ride','receipt',opts));
  assert.throws(()=>helper.venueUpdateReceiptLinks([] ,opts),/could not be confirmed/);
});

function endpoint({exists=true,withdrawn=false,writeError=false}={}){
  const calls=[];
  const admin={from(table){assert.equal(table,'venue_update_subscriptions');calls.push(['from']);const q={};
    for(const method of ['select','eq','update'])q[method]=(...args)=>{calls.push([method,...args]);return q;};
    q.maybeSingle=async()=>({data:exists?{channel:'email',withdrawn_at:withdrawn?'2026-10-01':null,venues:{name:'Club A'}}:null});
    q.then=(resolve,reject)=>Promise.resolve({error:writeError?new Error('Private database info'):null}).then(resolve,reject);return q;}};
  const route=load('app/api/public/venue-updates/route.ts',{
    'next/server':{NextResponse:{json:Response.json}},'@/src/lib/api':{PublicApiError,apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/security/browser-mutation':{requireSameOriginJsonMutation},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
  });
  return {calls,post:(body={token,action:'read'},headers={})=>route.POST(new Request('https://mydancr.com/api/public/venue-updates',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}))};
}

test('private management links read only their channel and unsubscribe idempotently without returning contact details',async()=>{
  const read=endpoint(),response=await read.post(),data=await response.json();assert.equal(data.active,true);
  assert.equal(data.venueName,'Club A');assert.equal(read.calls.some(c=>c[0]==='update'),false);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.doesNotMatch(JSON.stringify(data),/destination|manage_token|customer_id|guest@example/);
  const stop=endpoint(),stopped=await(await stop.post({token,action:'unsubscribe',venueId:'forged',destination:'forged'})).json();
  assert.equal(stopped.active,false);assert.equal(stop.calls.filter(c=>c[0]==='eq'&&c[1]==='manage_token'&&c[2]===token).length,2);
  assert.ok(stop.calls.find(c=>c[0]==='update')[1].withdrawn_at);
  const repeat=endpoint({withdrawn:true});assert.equal((await(await repeat.post({token,action:'unsubscribe'})).json()).active,false);assert.equal(repeat.calls.some(c=>c[0]==='update'),false);
});

test('malformed, foreign-origin and missing tokens cannot mutate preferences; failures never claim unsubscribed',async()=>{
  for(const [body,headers,status] of [[{token:'bad',action:'unsubscribe'},{},400],[{token,action:'subscribe'},{},400],[{token,action:'unsubscribe'},{origin:'https://other.test'},403],[{token,action:'unsubscribe'},{'content-type':'text/plain'},415]]){
    const f=endpoint();assert.equal((await f.post(body,headers)).status,status);assert.equal(f.calls.length,0);
  }
  assert.equal((await endpoint({exists:false}).post()).status,404);
  const failure=await endpoint({writeError:true}).post({token,action:'unsubscribe'});assert.equal(failure.status,500);assert.doesNotMatch(JSON.stringify(await failure.json()),/Private database info/);
});

test('venue subscriber reads select only consented contact channels and exclude unsubscribed records',async()=>{
  const helper=load('src/lib/dancr/venue-update-directory.ts',{'server-only':{}}),calls=[];
  const client={from(){const q={};for(const method of ['select','eq','is','in','order','range'])q[method]=(...args)=>{calls.push([method,...args]);return q;};
    q.then=(resolve,reject)=>Promise.resolve({data:[{id:'s',name:'Guest',channel:'email',destination:'guest@example.test',consented_at:'2026-10-12'}]}).then(resolve,reject);return q;}};
  const rows=await helper.listVenueUpdateSubscribers(client,'authorized-club','email',50);
  assert.equal(rows[0].phone,null);assert.equal(rows[0].email,'guest@example.test');assert.equal(rows[0].is_updates,true);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='venue_id'&&c[2]==='authorized-club'));
  assert.ok(calls.some(c=>c[0]==='is'&&c[1]==='withdrawn_at'&&c[2]===null));assert.deepEqual(calls.find(c=>c[0]==='range'),['range',50,100]);
  const annotated=await helper.attachVenueUpdateStatuses(client,'authorized-club',[{email:'GUEST@example.test',phone:'+17025550123'}]);
  assert.equal(annotated[0].email_updates_at,'2026-10-12');assert.equal(annotated[0].text_updates_at,null);
});
