import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../package.json',import.meta.url)),React=require('react'),ts=require('typescript');
const source=readFileSync(sourceRoot+'/app/admin/AdminDmcaPanel.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const caseId='a1700000-0000-4000-8000-000000000200',stamp='2026-09-12T00:01:02.123456+00:00';
const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.props?.children)];
const words=node=>node==null?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(words).join(''):words(node.props?.children);
function harness({patch=async()=>({message:'The case was marked as needing more information.'})}={}){
 const slots=[],effects=[],cleanups=[],requests=[];let cursor=0,dirty=true,tree,serverVersion=stamp,status='submitted';
 const hooks={...React,useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;dirty=true;}];},
  useRef(initial){const index=cursor++;return slots[index]||={current:initial};},useEffect(effect){const index=cursor++;if(!(index in slots)){slots[index]=true;effects.push(effect);}}};
 const library={};vm.runInNewContext(code,{exports:library,Error,Date,AbortController,FormData,require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);
  if(name==='./admin-session')return{async requestAdminJson(path,options={}){requests.push({path,options});if(options.method==='PATCH')return patch(options);return{cases:[{id:caseId,status,updatedAt:serverVersion,claimantName:'Synthetic claimant',strikes:[],counterNotices:[]}],agent:{legalName:'Synthetic agent',registeredWithCopyrightOffice:true}};}};
  throw new Error('Unexpected panel import '+name);
 }});
 function render(){if(!dirty)return;cursor=0;dirty=false;tree=library.default();effects.splice(0).forEach(effect=>cleanups.push(effect()));}
 render();return{requests,setVersion(value){serverVersion=value;},setStatus(value){status=value;},
  async settle(){await new Promise(resolve=>setImmediate(resolve));render();},
  button(label){return walk(tree).find(n=>n.type==='button'&&words(n)===label);},
  get textarea(){return walk(tree).find(n=>n.type==='textarea');},get text(){return words(tree);},
  get caseLookup(){return walk(tree).find(n=>n.type==='input'&&n.props.name==='caseLookup');},
  get agentFormKey(){return walk(tree).find(n=>n.type==='form')?.key;},
  unmount(){cleanups.forEach(f=>f?.());}};
}
test('review sends the exact displayed microsecond version with the reviewer notes',async()=>{
 const ui=harness();try{await ui.settle();ui.textarea.props.onChange({target:{value:'Preserve this note'}});await ui.settle();await ui.button('Request information').props.onClick();await ui.settle();
  const writes=ui.requests.filter(r=>r.options.method==='PATCH');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].options.body),{caseId,action:'request_information',notes:'Preserve this note',expectedUpdatedAt:stamp});
 }finally{ui.unmount();}
});
test('version conflict retains notes and requires an explicit refreshed decision',async()=>{
 let fail=true;const ui=harness({patch:async()=>{if(fail)throw new Error('The copyright case changed. Refresh it before deciding again.');return{message:'Case updated.'};}});
 try{await ui.settle();ui.textarea.props.onChange({target:{value:'Keep review notes'}});await ui.settle();await ui.button('Request information').props.onClick();await ui.settle();
  assert.match(ui.text,/Refresh it before deciding again/);assert.equal(ui.textarea.props.value,'Keep review notes');assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,1);
  const key=ui.agentFormKey,next='2026-09-12T00:01:03.654321+00:00';ui.setVersion(next);ui.button('Refresh cases').props.onClick();await ui.settle();assert.equal(ui.textarea.props.value,'Keep review notes');assert.equal(ui.agentFormKey,key);assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,1);
  fail=false;await ui.button('Request information').props.onClick();await ui.settle();assert.equal(JSON.parse(ui.requests.filter(r=>r.options.method==='PATCH')[1].options.body).expectedUpdatedAt,next);
 }finally{ui.unmount();}
});
test('duplicate clicks and refresh cannot repeat an in-flight review',async()=>{
 let release;const ui=harness({patch:()=>new Promise(resolve=>{release=resolve;})});
 try{await ui.settle();ui.textarea.props.onChange({target:{value:'Review notes'}});await ui.settle();const button=ui.button('Request information'),pending=button.props.onClick();button.props.onClick();await ui.settle();
  assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,1);assert.equal(ui.button('Refresh cases').props.disabled,true);assert.equal(ui.button('Request information').props.disabled,true);
  release({message:'Case updated.'});await pending;await ui.settle();assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,1);
 }finally{ui.unmount();}
});
test('partial email failure remains visible after a successful case refresh',async()=>{
 const message='The notice was rejected. Email delivery could not be confirmed. Review notification delivery; do not repeat the completed action.';
 const ui=harness({patch:async()=>({partial:true,message})});try{await ui.settle();ui.textarea.props.onChange({target:{value:'Review notes'}});await ui.settle();await ui.button('Reject notice').props.onClick();await ui.settle();assert.match(ui.text,/do not repeat the completed action/);assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,1);assert.equal(ui.textarea.props.value,'');}finally{ui.unmount();}
});
test('case refresh performs only a read and preserves unsaved notes and agent form',async()=>{
 const ui=harness();try{await ui.settle();ui.textarea.props.onChange({target:{value:'Unsaved note'}});await ui.settle();const key=ui.agentFormKey;ui.button('Refresh cases').props.onClick();await ui.settle();assert.equal(ui.textarea.props.value,'Unsaved note');assert.equal(ui.agentFormKey,key);assert.equal(ui.requests.length,2);assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,0);}finally{ui.unmount();}
});

test('uncertain terminal action retrieves the exact case without repeating the write or losing notes',async()=>{
 let ui;ui=harness({patch:async()=>{ui.setStatus('rejected');throw new Error('The copyright action could not be confirmed. Reopen the case and review its current state before trying again.');}});
 try{await ui.settle();ui.textarea.props.onChange({target:{value:'Preserve terminal decision notes'}});await ui.settle();const key=ui.agentFormKey;await ui.button('Reject notice').props.onClick();await ui.settle();
  assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,1);assert.equal(ui.requests.at(-1).path,'/api/admin/dmca?caseId='+caseId);assert.match(ui.text,/Rejected/);assert.equal(ui.textarea.props.value,'Preserve terminal decision notes');assert.equal(ui.agentFormKey,key);assert.equal(ui.button('Reject notice'),undefined);assert.match(ui.text,/could not be confirmed/);
  ui.button('Refresh cases').props.onClick();await ui.settle();assert.equal(ui.requests.at(-1).path,'/api/admin/dmca?caseId='+caseId);assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,1);
 }finally{ui.unmount();}
});
test('explicit saved-contact reload performs only a read and refreshes the form',async()=>{
 const ui=harness();try{assert.equal(ui.button('Save copyright agent').props.disabled,true);await ui.settle();assert.equal(ui.button('Save copyright agent').props.disabled,false);const key=ui.agentFormKey;ui.button('Reload saved contact details').props.onClick();await ui.settle();assert.notEqual(ui.agentFormKey,key);assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,0);}finally{ui.unmount();}
});
test('a completed case can be found by identity after reopening the panel without a new action',async()=>{
 const ui=harness();try{await ui.settle();const key=ui.agentFormKey;ui.setStatus('closed');ui.caseLookup.props.onChange({target:{value:caseId}});await ui.settle();ui.button('Find case').props.onClick();await ui.settle();assert.equal(ui.requests.at(-1).path,'/api/admin/dmca?caseId='+caseId);assert.match(ui.text,/Closed/);assert.equal(ui.agentFormKey,key);assert.equal(ui.requests.filter(r=>r.options.method==='PATCH').length,0);}finally{ui.unmount();}
});
