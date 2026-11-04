import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRootContentSecurityPolicy } from '../src/lib/security/root-content-security-policy.mjs';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

function compile(file, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Response,URL,Error,require:name=>{assert.ok(name in deps,name);return deps[name];}});
  return exports;
}
const page = compile('app/auth/email-action/route.ts', {
  '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY:'session' },
  '@/src/lib/security/root-content-security-policy.mjs': { createRootContentSecurityPolicy },
});
const success = { ok:true,purpose:'confirmation',returnTo:'/dashboard/dancer',account:{id:'dancer',accountState:'active'},session:{accessToken:'access',refreshToken:'refresh'} };
async function fixture(options={}) {
  const purpose=options.purpose===undefined?'confirmation':options.purpose;
  const location=new URL('https://www.mydancr.com/auth/email-action'+(purpose===null?'':'?purpose='+encodeURIComponent(purpose))+(options.missingLink?'':'#link=synthetic-secret'));
  const response=page.GET(new Request(location)),html=await response.text(),elements={},storage=new Map(),requests=[],detailsRequests=[],redirects=[];
  let releaseDetails;
  location.replace=value=>redirects.push(value);
  for(const [,tag,attributes,id,text] of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>([^<]*)/g)) {
    elements[id]={tagName:tag.toUpperCase(),disabled:/\bdisabled\b/.test(attributes),hidden:/\bhidden\b/.test(attributes),
      href:attributes.match(/\bhref="([^"]*)"/)?.[1],textContent:text,addEventListener(_event,fn){this.click=fn;}};
  }
  const document={getElementById:id=>{assert.ok(elements[id],id);return elements[id];}};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{
    URLSearchParams,Error,AbortSignal,location,document,
    history:{replaceState(_state,_title,url){location.href=new URL(url,location).href;}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){if(options.storageFails)throw new Error('Storage blocked');storage.set(key,value);}},
    fetch:async(url,init)=>{
      if(url==='/api/auth/email-action/details'){
        detailsRequests.push({url,...init});
        if(options.detailsFails)throw new Error('Details unavailable');
        if(options.holdDetails)await new Promise(resolve=>{releaseDetails=resolve;});
        return {ok:!options.detailsUnavailable,json:async()=>options.detailsResult||{ok:true,purpose:'confirmation'}};
      }
      requests.push({url,...init});if(options.switchSession)storage.set('session','another-account');
      if(requests.length===1&&options.requestFails)throw new Error('Temporary outage');
      return {ok:requests.length===2?!options.completionFails:true,json:async()=>options.result||success};},
  });
  return {response,elements,storage,requests,detailsRequests,redirects,location,click:()=>elements.continue.click(),
    settleDetails:()=>new Promise(setImmediate),releaseDetails:()=>releaseDetails()};
}
test('opening the email page is inert, removes its fragment and sends no credentials before Continue',async()=>{
  const f=await fixture();assert.deepEqual(f.requests,[]);assert.deepEqual(f.redirects,[]);assert.equal(f.location.hash,'');
  assert.deepEqual(Object.values(f.elements).filter(element=>['A','BUTTON'].includes(element.tagName)&&!element.hidden).map(element=>element.textContent),['Continue']);
  assert.equal(f.elements.heading.textContent,'Confirm your email');assert.equal(f.elements.status.hidden,false);
  assert.equal(f.elements.status.textContent,'Continue to confirm your email and finish setting up your account.');
  assert.match(f.response.headers.get('cache-control'),/private.*no-store/);
  assert.equal(f.response.headers.get('referrer-policy'),'no-referrer');
  assert.match(f.response.headers.get('content-security-policy'),/sha256-/);
  assert.deepEqual(f.detailsRequests,[]);
});

for(const [purpose,heading,message] of [
  ['recovery','Reset your password','Continue to choose a new password for your account.'],
  ['email_change','Confirm email change','Continue to confirm this email address for your account.'],
])test(`email-link instructions use fixed copy without redeeming the link: ${purpose}`,async()=>{
  const f=await fixture({purpose});assert.equal(f.elements.heading.textContent,heading);assert.equal(f.elements.status.textContent,message);
  assert.equal(f.elements.status.hidden,false);assert.equal(f.elements.signIn.hidden,true);assert.deepEqual(f.requests,[]);
  assert.equal(f.location.search,'');assert.equal(f.location.hash,'');
});

for(const [purpose,heading,message] of [
  ['confirmation','Confirm your email','Continue to confirm your email and finish setting up your account.'],
  ['recovery','Reset your password','Continue to choose a new password for your account.'],
  ['email_change','Confirm email change','Continue to confirm this email address for your account.'],
])test(`older ${purpose} links load matching instructions without consuming the link`,async()=>{
  const f=await fixture({purpose:null,detailsResult:{ok:true,purpose}});await f.settleDetails();
  assert.equal(f.elements.heading.textContent,heading);assert.equal(f.elements.status.textContent,message);
  assert.equal(f.detailsRequests.length,1);assert.equal(f.detailsRequests[0].method,'POST');
  assert.equal(f.detailsRequests[0].cache,'no-store');assert.deepEqual(JSON.parse(f.detailsRequests[0].body),{link:'synthetic-secret'});
  assert.deepEqual(f.requests,[]);assert.deepEqual(f.redirects,[]);assert.equal(f.storage.size,0);
  assert.equal(f.elements.continue.disabled,false);assert.equal(f.elements.signIn.hidden,true);assert.equal(f.location.hash,'');
});

test('an unknown display hint is resolved from the signed link instead of rendered',async()=>{
  const f=await fixture({purpose:'<script>alert(1)</script>',detailsResult:{ok:true,purpose:'recovery'}});await f.settleDetails();
  assert.equal(f.elements.heading.textContent,'Reset your password');assert.deepEqual(f.requests,[]);
});

for(const options of [{detailsFails:true},{detailsUnavailable:true},{detailsResult:{ok:true,purpose:'__proto__'}}])test(`an unavailable details lookup leaves Continue usable: ${JSON.stringify(options)}`,async()=>{
  const f=await fixture({purpose:null,...options});await f.settleDetails();
  assert.equal(f.elements.heading.textContent,'Continue');assert.equal(f.elements.continue.disabled,false);
  assert.equal(f.elements.status.textContent,'Continue to complete the action from your email.');
  await f.click();assert.equal(f.requests.length,2);assert.deepEqual(f.redirects,['/dashboard/dancer']);
});

test('an older URL missing its private link does not request details',async()=>{
  const f=await fixture({purpose:null,missingLink:true});await f.settleDetails();assert.deepEqual(f.detailsRequests,[]);
  await f.click();assert.deepEqual(f.requests,[]);assert.equal(f.elements.signIn.hidden,false);
});

for(const result of [{ok:true,complete:true,returnTo:'/admin',message:'Your email has been changed.'},{ok:false,error:'This link is unavailable.'}])test(`late details cannot replace the result of pressing Continue: ${JSON.stringify(result)}`,async()=>{
  const f=await fixture({purpose:null,holdDetails:true,detailsResult:{ok:true,purpose:'email_change'},result});
  await f.click();const heading=f.elements.heading.textContent,status=f.elements.status.textContent;
  f.releaseDetails();await f.settleDetails();assert.equal(f.elements.heading.textContent,heading);assert.equal(f.elements.status.textContent,status);
  assert.equal(f.elements.signIn.hidden,false);
});

test('a changed display hint cannot change the action returned by the server',async()=>{
  const f=await fixture({purpose:'email_change'});await f.click();
  assert.equal(f.requests.length,2);assert.equal(JSON.parse(f.requests[1].body).action,'complete');
  assert.deepEqual(f.redirects,['/dashboard/dancer']);
  assert.deepEqual(JSON.parse(f.requests[0].body),{link:'synthetic-secret'});
});

test('older links without a display hint still complete normally',async()=>{
  const f=await fixture({purpose:null});await f.click();assert.equal(f.requests.length,2);assert.deepEqual(f.redirects,['/dashboard/dancer']);
});
for(const role of ['dancer','customer','venue','admin'])test(`${role} confirmation completes only after the browser saves the returned session`,async()=>{
  const destination=role==='admin'?'/admin':`/dashboard/${role}`;
  const f=await fixture({result:{...success,returnTo:destination,account:{id:role,role,accountState:'active'}}});await f.click();assert.equal(f.requests.length,2);
  assert.equal(JSON.parse(f.storage.get('session')).account.id,role);
  assert.equal(f.requests[1].headers.authorization,'Bearer access');
  assert.equal(JSON.parse(f.requests[1].body).action,'complete');
  assert.deepEqual(f.redirects,[destination]);assert.equal(f.elements.signIn.hidden,true);
});
for(const options of [{storageFails:true},{switchSession:true},{requestFails:true},{result:{...success,account:{id:'dancer',accountState:'disabled'}}}])test(`interrupted confirmation does not consume the link ${JSON.stringify(options)}`,async()=>{
  const f=await fixture(options);await f.click();assert.equal(f.requests.length,1);assert.deepEqual(f.redirects,[]);assert.equal(f.elements.continue.disabled,false);
  assert.equal(f.elements.signIn.hidden,false);assert.equal(f.elements.status.hidden,false);
});

for(const options of [{missingLink:true},{result:{ok:false,error:'This email link is no longer available.'}}])test(`unavailable email links expose sign-in recovery ${JSON.stringify(options)}`,async()=>{
  const f=await fixture(options);await f.click();assert.deepEqual(f.redirects,[]);assert.equal(f.storage.size,0);
  assert.equal(f.elements.signIn.hidden,false);assert.equal(f.elements.continue.textContent,'Try again');
  assert.equal(f.elements.status.hidden,false);assert.ok(f.elements.status.textContent);
});

test('retrying hides the recovery action while processing the link again',async()=>{
  const f=await fixture({requestFails:true});await f.click();assert.equal(f.elements.signIn.hidden,false);
  const retry=f.click();assert.equal(f.elements.signIn.hidden,true);assert.equal(f.elements.continue.disabled,true);
  await retry;assert.deepEqual(f.redirects,['/dashboard/dancer']);assert.equal(f.elements.signIn.hidden,true);
});
test('a completion outage keeps the page retryable with the session already saved',async()=>{
  const f=await fixture({completionFails:true});await f.click();assert.equal(f.requests.length,2);assert.ok(f.storage.get('session'));assert.deepEqual(f.redirects,[]);assert.equal(f.elements.continue.disabled,false);
});
test('recovery opens the password form without consuming the recovery action',async()=>{
  const f=await fixture({purpose:'recovery',result:{...success,purpose:'recovery',returnTo:'/account/reset-password'}});await f.click();
  assert.equal(f.requests.length,1);assert.deepEqual(f.redirects,['/account/reset-password']);
  assert.equal(f.elements.signIn.hidden,true);
});
test('the first inbox confirmation keeps the existing session and requests the second inbox',async()=>{
  const f=await fixture({result:{ok:true,pending:true}});f.storage.set('session','existing');await f.click();
  assert.equal(f.storage.get('session'),'existing');assert.equal(f.elements.continue.hidden,true);assert.match(f.elements.status.textContent,/other inbox/);assert.deepEqual(f.redirects,[]);
  assert.equal(f.elements.signIn.hidden,true);assert.equal(f.elements.status.hidden,false);
});

test('admin email completion links back to admin without changing the current browser session',async()=>{
  const f=await fixture({result:{ok:true,complete:true,returnTo:'/admin',message:'Your email has been changed.'}});
  f.storage.set('session','existing');await f.click();
  assert.equal(f.elements.signIn.href,'/admin');assert.equal(f.elements.continue.hidden,true);
  assert.equal(f.elements.signIn.hidden,false);assert.equal(f.elements.status.hidden,false);
  assert.equal(f.storage.get('session'),'existing');assert.deepEqual(f.redirects,[]);
});

test('email completion never uses an external sign-in destination',async()=>{
  const f=await fixture({result:{ok:true,complete:true,returnTo:'https://outside.example',message:'Email changed.'}});
  await f.click();assert.equal(f.elements.signIn.href,'/?auth=login');
  assert.equal(f.elements.signIn.hidden,false);assert.equal(f.elements.continue.hidden,true);
});
test('email-action completion requires a verified session; redemption cannot complete it implicitly',async()=>{
  const calls=[];let signedIn=false;
  const route=compile('app/api/auth/email-action/route.ts',{
    'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:()=>Response.json({ok:false},{status:401})},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>{if(!signedIn)throw new Error('No session');return {user:{id:'verified-user'}};}},
    '@/src/lib/dancr/email-actions':{EMAIL_ACTION_HEADERS:{'cache-control':'private, no-store','referrer-policy':'no-referrer'},readEmailActionToken:link=>{assert.equal(link,'private');return {id:'action'};},
      completeEmailConfirmation:async(_admin,id)=>calls.push(['complete',id]),redeemEmailAction:async()=>{calls.push(['redeem']);return success;}},
  });
  const send=action=>route.POST(new Request('https://mydancr.test/api/auth/email-action',{method:'POST',body:JSON.stringify({link:'private',action})}));
  assert.equal((await send('complete')).status,401);assert.deepEqual(calls,[]);
  assert.equal((await send()).status,200);assert.deepEqual(calls,[['redeem']]);
  signedIn=true;const result=await send('complete');assert.equal(result.status,200);assert.deepEqual(calls.at(-1),['complete','verified-user']);
  assert.match(result.headers.get('cache-control'),/no-store/);
});

test('the separate details endpoint validates the link and returns only display metadata',async()=>{
  const calls=[];
  const route=compile('app/api/auth/email-action/details/route.ts',{
    'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:()=>Response.json({ok:false},{status:409})},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},
    '@/src/lib/dancr/email-actions':{
      EMAIL_ACTION_HEADERS:{'cache-control':'private, no-store','referrer-policy':'no-referrer'},
      readEmailActionToken:link=>{if(link!=='private')throw new Error('Invalid link');calls.push('validated');return {id:'action'};},
      getEmailActionDetails:async(_admin,claim)=>{assert.equal(claim.id,'action');calls.push('read');return {purpose:'confirmation'};},
    },
  });
  const send=link=>route.POST(new Request('https://mydancr.test/api/auth/email-action/details',{method:'POST',body:JSON.stringify({link})}));
  assert.equal((await send('bad')).status,409);assert.deepEqual(calls,[]);
  const result=await send('private');assert.deepEqual(await result.json(),{ok:true,purpose:'confirmation'});assert.deepEqual(calls,['validated','read']);
  assert.match(result.headers.get('cache-control'),/no-store/);assert.equal(result.headers.get('referrer-policy'),'no-referrer');
  assert.equal(route.GET,undefined);
});
