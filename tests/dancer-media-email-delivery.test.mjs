import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('src/lib/dancr/dancer-media-email-delivery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const target={email:'dancer@example.invalid',title:'Main photo needs replacing',body:'Club <A> did not approve your main photo.',payload:{emailPath:'/dashboard/dancer#dancer-main-photo'}};
function fixture({status=200,fail=false,configured=true,body={id:'provider-id'}}={}){
 const exports={},calls=[];vm.runInNewContext(code,{exports,performance,AbortSignal,Response,Error,process:{env:configured?{RESEND_API_KEY:'test',EMAIL_FROM:'sender@example.invalid'}:{}},require:()=>({publicAppUrl:()=> 'https://mydancr.com'}),fetch:async(url,init)=>{calls.push({url,init});if(fail)throw Error('Offline');return Response.json(body,{status});}});
 return {...exports,calls};
}
test('email links directly to the right editor, escapes text and rejects external links',()=>{
 const f=fixture(),content=f.dancerMediaEmailContent(target);assert.match(content.text,/https:\/\/mydancr.com\/dashboard\/dancer#dancer-main-photo/);
 assert.match(content.html,/Club &lt;A&gt;/);
 assert.match(f.dancerMediaEmailContent({...target,payload:{emailPath:'https://evil.invalid'}}).text,/mydancr.com\/dashboard\/dancer#dancer-photos-title/);
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
