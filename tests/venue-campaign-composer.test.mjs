import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../app/dashboard/VenueCampaignComposer.tsx',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 const slots=[],effects=[],calls=[];let index=0,dirty=false,respond;
 const info={venueName:'Club A',channels:{in_app:true,email:true,push:true},counts:{in_app:2},history:[]};
 const campaign={id:'preview',status:'draft',sender_name:'Club A',subject:'Tonight',body:'Offer details',recipient_count:2,published_count:1,skipped_count:1};
 respond=async(_url,options)=>options.method==='POST'?{campaign:{...campaign,id:JSON.parse(options.body).id,status:JSON.parse(options.body).action==='send'?'published':'draft'},preview:campaign.body}:info;
 const hooks={
  useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=initial;return [slots[slot],next=>{const value=typeof next==='function'?next(slots[slot]):next;if(!Object.is(value,slots[slot])){slots[slot]=value;dirty=true;}}];},
  useRef(initial){const slot=index++;return slots[slot]||=( {current:initial});},
  useCallback(fn,deps){const slot=index++;const old=slots[slot];if(!old||!deps.every((x,i)=>Object.is(x,old.deps[i])))slots[slot]={deps,fn};return slots[slot].fn;},
  useEffect(effect,deps){const slot=index++;const old=slots[slot];if(old&&deps.every((x,i)=>Object.is(x,old.deps[i])))return;effects.push(()=>{old?.cleanup?.();slots[slot]={deps,cleanup:effect()};});},
 };
 const exports={};
 vm.runInNewContext(code,{exports,AbortController,crypto:{randomUUID},Error,require:name=>{
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);
  if(name==='./dashboard-session')return {requestDashboardJson:async(url,options)=>{calls.push({url,...options});return respond(url,options);}};
  if(name==='../components/RefreshButton')return {default:'refresh-button'};if(name.endsWith('.css'))return {};
  throw new Error('Unexpected import '+name);
 }});
 function render(){let tree;for(let pass=0;pass<10;pass++){index=0;dirty=false;tree=exports.default({active:true,refreshKey:'owner:1'});effects.splice(0).forEach(f=>f());if(!dirty)return tree;}throw new Error('Render did not settle');}
 function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const match=find(child,predicate);if(match)return match;}return null;}
 function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return [node.props?.children].flat(Infinity).map(text).join('');}
 const get=predicate=>find(render(),predicate);
 const button=label=>get(n=>n.type==='button'&&text(n).startsWith(label));
 async function preview(){button('+ Create').props.onClick();render();await flush();render();get(n=>n.type==='input').props.onChange({target:{value:'Tonight'}});get(n=>n.type==='textarea').props.onChange({target:{value:'Offer details'}});get(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();render();}
 return {calls,info,campaign,render,find,get,text,button,preview,respondWith:fn=>{respond=fn;},postCalls:()=>calls.filter(c=>c.method==='POST'),notice:()=>get(n=>n.props?.role==='status'),error:()=>get(n=>n.props?.role==='alert')};
}
async function compose(f,body) {
 f.button('+ Create').props.onClick();f.render();await flush();f.render();
 f.get(n=>n.type==='input').props.onChange({target:{value:'Hi'}});
 f.get(n=>n.type==='textarea').props.onChange({target:{value:body}});f.render();
}
test('a short message can be previewed and the counter clearly states a maximum',async()=>{
 const f=fixture();await compose(f,'Hi');
 assert.equal(f.button('Preview offer').props.disabled,false);
 assert.match(f.text(f.get(n=>n.props?.id==='venue-campaign-message-help')),/2 characters used · 5,000 maximum\. Short messages are welcome/);
 f.get(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();f.render();
 assert.equal(JSON.parse(f.postCalls()[0].body).body,'Hi');
});
test('an empty audience explains the disabled preview independently of message length',async()=>{
 const f=fixture();f.info.counts.in_app=0;await compose(f,'A short offer');
 assert.equal(f.button('Preview offer').props.disabled,true);
 const help=f.get(n=>n.props?.id==='venue-campaign-audience-help');
 assert.match(f.text(help),/no eligible recipients yet/);
 assert.equal(f.button('Preview offer').props['aria-describedby'],help.props.id);
 assert.equal(f.postCalls().length,0);
});
test('composer waits to be opened and previews before publishing to Alerts',async()=>{
 const f=fixture();f.render();assert.equal(f.calls.length,0);
 await f.preview();assert.equal(f.postCalls().length,1);
 const preview=JSON.parse(f.postCalls()[0].body);assert.equal(preview.action,'preview');assert.equal(preview.channel,'in_app');
 assert.equal(preview.subject,'Tonight');assert.equal(preview.body,'Offer details');
 assert.equal(f.notice(),null);
 f.button('Publish to').props.onClick();await flush();f.render();
 assert.equal(JSON.parse(f.postCalls()[1].body).action,'send');
 assert.match(f.text(f.notice()),/Offer added to 1 customer Alerts/);
});
test('pending publication prevents duplicate submissions',async()=>{
 const f=fixture();await f.preview();let resolve;
 f.respondWith(async(_url,options)=>options.method==='POST'?new Promise(done=>{resolve=done;}):f.info);
 const publish=f.button('Publish to');publish.props.onClick();publish.props.onClick();f.render();
 assert.equal(f.postCalls().length,2);assert.equal(f.button('Publishing').props.disabled,true);assert.equal(f.notice(),null);
 resolve({campaign:{...f.campaign,status:'published'},preview:f.campaign.body});await flush();f.render();
 assert.match(f.text(f.notice()),/Offer added to 1/);
});
test('a failed publish retains its preview and retries the same idempotent campaign',async()=>{
 const f=fixture();await f.preview();
 f.respondWith(async()=>{throw new Error('Connection lost. Retry.');});
 f.button('Publish to').props.onClick();await flush();f.render();
 assert.match(f.text(f.error()),/Connection lost/);assert.equal(f.notice(),null);
 const failed=JSON.parse(f.postCalls()[1].body);
 f.respondWith(async(_url,options)=>options.method==='POST'?{campaign:{...f.campaign,status:'published'}}:f.info);
 f.button('Publish to').props.onClick();await flush();f.render();
 assert.equal(JSON.parse(f.postCalls()[2].body).id,failed.id);
 assert.match(f.text(f.notice()),/Offer added to 1/);
});
test('a concurrent withdrawal cannot be presented as a successful publication',async()=>{
 const f=fixture();await f.preview();
 f.respondWith(async()=>({campaign:{...f.campaign,status:'cancelled'}}));
 f.button('Publish to').props.onClick();await flush();f.render();
 assert.equal(f.notice(),null);assert.match(f.text(f.error()),/not published/);
});
