import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerMediaBatchSubmission.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./dashboard-session'?{}:require(n)});
test('off-shift updates explain automatic submission without offering a send button',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default,{disabled:false,refreshKey:'test',venueId:'club-a',checkedIn:false}));
 assert.match(html,/Saved for check-in/);assert.match(html,/automatically when you tap in/);assert.equal(html.includes('>Submit media updates</button>'),false);
});
test('checked-in editing still offers the explicit batch Submit button',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default,{disabled:false,refreshKey:'test',venueId:'club-a',checkedIn:true}));
 assert.ok(html.includes('>Submit media updates</button>'));assert.doesNotMatch(html,/Saved for check-in/);
});

const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[];
const text=node=>typeof node==='string'?node:[node?.props?.children].flat(Infinity).map(child=>typeof child==='object'?text(child):String(child??'')).join('');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function mount(overrides={}) {
 const slots=[],effects=[],requests=[],timers=new Map(),listeners=new Map();let cursor=0,tree,timerId=0;
 let props={disabled:false,refreshKey:'same-upload',venueId:'club-b',checkedIn:true,hasPendingMedia:true,...overrides};
 const hooks={
  useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
  useRef(value){const i=cursor++;return slots[i]||=({current:value});},
  useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={deps,value:fn};return slots[i].value;},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=effect());}},
 };
 const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 const window={setInterval:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearInterval:id=>timers.delete(id)};
 const result={},jsx=(type,props)=>({type,props});
 vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerMediaBatchSubmission.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:result,AbortController,Error,window,document,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{requestDashboardJson:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))},
 });
 function render(){cursor=0;tree=result.default(props);while(effects.length)effects.shift()();}
 render();
 return {requests,timers,document,render,button:()=>nodes(tree).find(node=>node.type==='button'&&text(node)==='Submit media updates'),
  tick(){for(const timer of [...timers.values()])timer.fn();},
  visible(){document.visibilityState='visible';listeners.get('visibilitychange')?.();},
  update(next){props={...props,...next};render();},
  async complete(i,data={}){requests[i].resolve({draftCount:0,batches:[],...data});await settle();render();},
  async fail(i){requests[i].reject(new Error('Temporary failure'));await settle();render();},
  close(){slots.forEach(slot=>slot?.cleanup?.());},
 };
}

test('processing media enables Submit automatically without a profile change or refresh click',async()=>{
 const f=mount();await f.complete(0);assert.equal(f.button().props.disabled,true);
 f.tick();assert.equal(f.requests.length,2);assert.equal(f.requests[1].options.headers['x-dancer-media-venue'],'club-b');
 f.tick();assert.equal(f.requests.length,2,'slow status requests must not overlap or be aborted');
 assert.equal(f.requests[1].options.signal.aborted,false);
 await f.complete(1,{draftCount:1});assert.equal(f.button().props.disabled,false);assert.equal(f.timers.size,0);
 f.close();
});

test('pending older reviews do not prevent a fresh upload becoming submittable',async()=>{
 const f=mount();await f.complete(0,{batches:[{state:'admin'}]});f.tick();
 await f.complete(1,{draftCount:1,batches:[{state:'admin'}]});assert.equal(f.button().props.disabled,false);f.close();
});

test('automatic readiness checks pause when hidden and retry after a transient failure',async()=>{
 const f=mount();await f.complete(0);f.document.visibilityState='hidden';f.tick();assert.equal(f.requests.length,1);
 f.visible();assert.equal(f.requests.length,2);await f.fail(1);f.tick();await f.complete(2,{draftCount:1});
 assert.equal(f.button().props.disabled,false);f.close();
});

test('idle and busy editors do not poll; leaving or changing clubs cancels stale reads',async()=>{
 const idle=mount({hasPendingMedia:false});await idle.complete(0);assert.equal(idle.timers.size,0);idle.close();
 const f=mount({disabled:true});assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);
 f.update({disabled:false});await f.complete(0);f.tick();f.update({venueId:'club-a'});
 assert.equal(f.requests[1].options.signal.aborted,true);assert.equal(f.requests[2].options.headers['x-dancer-media-venue'],'club-a');
 await f.complete(1,{draftCount:7});await f.complete(2);assert.equal(f.button().props.disabled,true);
 f.tick();f.close();assert.equal(f.requests[3].options.signal.aborted,true);assert.equal(f.timers.size,0);
});
