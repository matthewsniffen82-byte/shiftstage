import * as emailRouting from '../src/lib/dancr/email-routing.ts';
import * as visibilityLinks from '../src/lib/dancr/dancer-visibility-alert-link.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('src/lib/dancr/dancer-media-email-delivery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const target={email:'dancer@example.invalid',title:'Main photo needs replacing',body:'Club <A> did not approve your main photo.',payload:{emailPath:'/dashboard/dancer#dancer-main-photo'}};
function fixture({status=200,fail=false,configured=true,body={id:'provider-id'}}={}){
 const exports={},calls=[];vm.runInNewContext(code,{exports,performance,AbortSignal,Response,Error,process:{env:configured?{RESEND_API_KEY:'test',EMAIL_FROM:'sender@example.invalid'}:{}},require:n=>n === './email-routing' ? emailRouting : n === './dancer-visibility-alert-link' ? visibilityLinks : ({publicAppUrl:()=> 'https://mydancr.com'}),fetch:async(url,init)=>{calls.push({url,init});if(fail)throw Error('Offline');return Response.json(body,{status});}});
 return {...exports,calls};
}
test('email links directly to the right editor, escapes text and rejects external links',()=>{
 const f=fixture(),content=f.dancerMediaEmailContent(target);assert.match(content.text,/https:\/\/mydancr.com\/dashboard\/dancer#dancer-main-photo/);
 assert.match(content.html,/Club &lt;A&gt;/);
 assert.match(f.dancerMediaEmailContent({...target,payload:{emailPath:'https://evil.invalid'}}).text,/mydancr.com\/dashboard\/dancer#dancer-photos-title/);
});

test('photo, video and main-photo replacement links keep the reviewed club across sign-in', () => {
  const venueId = '00000000-0000-4000-8000-000000000003';
  for (const anchor of ['dancer-main-photo', 'dancer-photos-title', 'dancer-videos-title']) {
    const payload = { kind: 'dancer_media_batch_result', action: 'Replace media', emailPath: '/dashboard/dancer#' + anchor, venueId };
    const content = fixture().dancerMediaEmailContent({ ...target, payload });
    assert.ok(content.text.includes(`/dashboard/dancer?mediaClub=${venueId}#${anchor}`));
  }
});
test('visibility alerts select the affected club and editor without accepting a payload redirect',()=>{
 const venueId='00000000-0000-4000-8000-000000000003';
 for(const [mediaType,tab] of [['photos','media'],['videos','video']]){
  const content=fixture().dancerMediaEmailContent({...target,payload:{kind:'dancer_visibility_blocked',venueId,mediaType,emailPath:'https://evil.invalid'}});
  assert.ok(content.html.includes(`href="https://mydancr.com/dashboard/dancer?mediaClub=${venueId}#dancer-profile-${tab}-library">Review club media</a>`));
  assert.doesNotMatch(content.text,/evil.invalid/);
 }
 assert.equal(visibilityLinks.dancerVisibilityAlertPath({venueId:'../evil?next=//evil.invalid',mediaType:'untrusted'}),'/dashboard/dancer#dancer-profile-media-library');
});

test('full approval email opens the dancer dashboard without implying a live shift',async()=>{
 const f=fixture(),approval={...target,title:'Your MyDancr profile is approved',body:'Your MyDancr dancer profile is approved.',payload:{kind:'dancer_profile_approved',emailPath:'https://evil.invalid'}};
 const content=f.dancerMediaEmailContent(approval);
 assert.equal(content.subject,'Your MyDancr profile is approved');
 assert.match(content.html,/<a href="https:\/\/mydancr.com\/dashboard\/dancer">Open dancer dashboard<\/a>/);
 assert.doesNotMatch(content.text,/Update your media|working now|evil.invalid/i);
 for(let i=0;i<2;i++)assert.equal((await f.sendDancerMediaEmail({id:'approval-job',lease_id:'lease'},approval)).status,'accepted');
 assert.equal(f.calls[0].init.headers['Idempotency-Key'],'dancer-media/approval-job');
 assert.equal(f.calls[1].init.headers['Idempotency-Key'],f.calls[0].init.headers['Idempotency-Key']);
});

test('a club decline and a completed onboarding batch both link directly to the dashboard',()=>{
 for(const payload of [{kind:'dancer_club_request_declined'}, {kind:'dancer_media_batch_result',outcome:'approved',action:'View results'}]){
  const content=fixture().dancerMediaEmailContent({...target,payload:{...payload,emailPath:'/dashboard/dancer#dancer-photos-title'}});
  assert.ok(content.html.includes('href="https://mydancr.com/dashboard/dancer">Open dancer dashboard</a>'));
 }
});

test('a club-specific batch result opens the affected club and missing media type',()=>{
 const venueId='00000000-0000-4000-8000-000000000003';
 for(const [anchor,library] of [['photos','media'],['videos','video']]){
  const payload={kind:'dancer_media_batch_result',action:'Review club media',emailPath:`/dashboard/dancer#dancer-${anchor}-title`,venueId};
  const content=fixture().dancerMediaEmailContent({...target,payload});
  assert.ok(content.html.includes(`href="https://mydancr.com/dashboard/dancer?mediaClub=${venueId}#dancer-profile-${library}-library">Review club media</a>`));
 }
 const update=fixture().dancerMediaEmailContent({...target,payload:{kind:'dancer_media_batch_result',outcome:'approved',action:'View club results',venueId}});
 assert.ok(update.html.includes(`href="https://mydancr.com/dashboard/dancer?mediaClub=${venueId}#dancer-profile-media-library">View club results</a>`));
});

test('one review summary renders all rejection counts and a single dashboard link',()=>{
 const f=fixture(),content=f.dancerMediaEmailContent({...target,title:'Your media review results',
  body:'Your media review is complete. 2 photos and 1 video were not approved.\n\nOpen your dashboard to see all results & upload replacements.',
  payload:{kind:'dancer_media_review_summary'}});
 assert.equal(content.subject,'Your media review results');
 assert.match(content.html,/2 photos and 1 video were not approved\.<\/p><p>Open your dashboard/);
 assert.match(content.html,/&amp;/);assert.equal(content.html.match(/<a /g).length,1);
});
for(const [action,path] of [['Choose main photo','/dashboard/dancer#dancer-main-photo'],['Replace media','/dashboard/dancer#dancer-videos-title'],['View results','/dashboard/dancer#dancer-photos-title'],['Continue setup','/dashboard/dancer']])
 test(`final outcome email uses ${action} and its matching destination`,()=>{
  const content=fixture().dancerMediaEmailContent({...target,payload:{kind:'dancer_media_review_summary',action,emailPath:path}});
  assert.ok(content.html.includes(`href="https://mydancr.com${path}">${action}</a>`));
 });
test('retries use the same provider idempotency key and report actual acceptance',async()=>{
 const f=fixture();for(let i=0;i<2;i++)assert.equal((await f.sendDancerMediaEmail({id:'job',lease_id:'lease'},target)).status,'accepted');
 assert.equal(f.calls[0].init.headers['Idempotency-Key'],f.calls[1].init.headers['Idempotency-Key']);
});
for(const [options,expected]of [[{status:429},'retry'],[{status:503},'retry'],[{status:422},'failed'],[{fail:true},'retry'],[{body:{}},'retry'],[{configured:false},'retry']])
 test(`provider ${JSON.stringify(options)} yields ${expected}`,async()=>{assert.equal((await fixture(options).sendDancerMediaEmail({id:'job'},target)).status,expected);});
test('worker skips resolved media and records failed sends for retry',async()=>{
 for(const resolved of [true,false]){
  const f=fixture({fail:true}),calls=[];let claim=0;
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='claim_dancer_media_emails'?(claim++?[]:[{id:'job',lease_id:'lease'}]):name==='dancer_media_email_target'?(resolved?null:target):true,error:null};}};
  const counts=await f.deliverDancerMediaEmails(client);assert.equal(counts[resolved?'skipped':'retry'],1);
  assert.equal(calls.find(c=>c.name==='finish_dancer_media_email').args.p_status,resolved?'skipped':'retry');
  assert.equal(f.calls.length,resolved?0:1);
 }
});
