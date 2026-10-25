import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('app/dashboard/CustomerClubPrivacyPanel.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const club={venue_id:'club',venue_name:'Club A',share:{name:'Guest',email:'guest@example.test',city:'Miami',consentedAt:'2026-10-01'},subscriptions:[
  {id:'email',channel:'email',destination:'guest@example.test',consentedAt:'2026-10-01',withdrawnAt:null},
  {id:'text',channel:'text',destination:'+17025550123',consentedAt:'2026-10-01',withdrawnAt:null},
]};
function fixture() {
  const slots=[],calls=[];let index=0,effects=[],dirty=true,tree,sessionId='guest';
  let respond=async(_,options)=>options.method==='POST'?{ok:true}:{clubs:[club],hasMore:false,verifiedEmail:'guest@example.test'};
  const hooks={
    useState(initial){const i=index++;if(!(i in slots))slots[i]={value:initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
    useRef(initial){const i=index++;return slots[i]||=( {current:initial});},
    useEffect(fn,deps){const i=index++,previous=slots[i];if(!previous||deps.some((d,j)=>!Object.is(d,previous.deps[j])))effects.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  const jsx=(type,props)=>({type,props}),exports={};
  const listeners=new Map();
  vm.runInNewContext(code,{exports,AbortController,Date,Error,Event,window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),dispatchEvent:event=>listeners.get(event.type)?.()},require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/src/lib/dancr/customer-club-privacy'?{CLUB_PRIVACY_CHANGED_EVENT:'privacy-changed'}:name==='./dashboard-session'?{
    readSession:()=>({account:{id:sessionId}}),requestDashboardJson:(url,options)=>{calls.push({url,options});return respond(url,options);},
  }: {}});
  function render(){for(let n=0;dirty&&n<30;n++){dirty=false;index=0;effects=[];tree=exports.default({accountId:'guest'});effects.forEach(fn=>fn());}assert.equal(dirty,false);return tree;}
  function nodes(node=tree){return node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child=>nodes(child))]:[];}
  async function settle(){for(let n=0;n<8;n++){await Promise.resolve();render();}}
  render();
  return {calls,nodes,render,settle,
    open(){tree.props.onToggle({currentTarget:{open:true}});render();},
    button(label){return nodes().find(n=>n.type==='button'&&[n.props.children].flat(Infinity).join('')===label);},
    status(){return nodes().filter(n=>n.props?.role==='status').map(n=>n.props.children).join(' ');},
    text(){return nodes().flatMap(n=>[n.props?.children].flat(Infinity).filter(v=>typeof v==='string')).join(' ');},
    respondWith(fn){respond=fn;},switchAccount(){sessionId='other';},
    unmount(){slots.forEach(s=>s.cleanup?.());},
  };
}
test('privacy loads only when opened and shows independent contact, email and text choices',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);f.open();await f.settle();
  assert.equal(f.calls[0].options.expectedRole,'customer');assert.ok(f.button('Stop sharing'));assert.ok(f.button('Stop email updates'));assert.ok(f.button('Stop text updates'));
  assert.match(f.text(),/Guest.*guest@example.test/);
});
test('stopping contact sharing leaves update channels enabled',async()=>{
  const f=fixture();f.open();await f.settle();f.button('Stop sharing').props.onClick();await f.settle();
  assert.deepEqual(JSON.parse(f.calls[1].options.body),{action:'stop_sharing',venueId:'club'});
  assert.equal(f.button('Stop sharing'),undefined);assert.ok(f.button('Stop email updates'));assert.ok(f.button('Stop text updates'));assert.match(f.status(),/Contact sharing stopped/);
});
test('stopping email waits for success and never changes text or contact sharing',async()=>{
  const f=fixture();f.open();await f.settle();let resolve;f.respondWith(()=>new Promise(done=>{resolve=done;}));
  f.button('Stop email updates').props.onClick();f.render();assert.equal(f.button('Stop email updates').props.disabled,true);
  f.button('Stop email updates').props.onClick();assert.equal(f.calls.length,2);
  resolve({ok:true});await f.settle();assert.equal(f.button('Stop email updates'),undefined);assert.ok(f.button('Stop text updates'));assert.ok(f.button('Stop sharing'));
});
test('a failed save retains the prior preferences and permits a retry',async()=>{
  const f=fixture();f.open();await f.settle();f.respondWith(async()=>{throw new Error('Could not save');});
  f.button('Stop text updates').props.onClick();await f.settle();assert.ok(f.button('Stop text updates'));assert.equal(f.button('Stop text updates').props.disabled,false);assert.match(f.text(),/Could not save/);assert.doesNotMatch(f.status(),/stopped/);
});
for(const action of ['switchAccount','unmount'])test(`late preference results are ignored after ${action}`,async()=>{
  const f=fixture();let resolve;f.respondWith(()=>new Promise(done=>{resolve=done;}));f.open();f[action]();resolve({clubs:[club],hasMore:false});await f.settle();
  assert.equal(f.button('Stop sharing'),undefined);if(action==='unmount')assert.equal(f.calls[0].options.signal.aborted,true);
});
test('a private link is submitted explicitly and refreshes the saved preference list',async()=>{
  const f=fixture();f.open();await f.settle();
  f.nodes().find(n=>n.type==='input').props.onChange({target:{value:'/updates/'+'x'.repeat(43)}});f.render();
  f.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await f.settle();
  assert.equal(JSON.parse(f.calls[1].options.body).action,'link');assert.equal(f.calls[2].url,'/api/customer/club-privacy?page=0');
  assert.equal(f.nodes().find(n=>n.type==='input').props.value,'');assert.match(f.status(),/Club update preferences linked/);
});
