import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { AdminDataRequestError, isAdminAuthenticationError } from '../app/admin/admin-session.ts';
const nodes=n=>n&&typeof n==='object'?[n,...[n.props?.children].flat(Infinity).flatMap(nodes)]:[];
const text=n=>typeof n==='string'?n:[n?.props?.children].flat(Infinity).map(x=>typeof x==='object'?text(x):String(x??'')).join('');
const settle=()=>new Promise(r=>setImmediate(r));
function mount(children){
 const slots=[],effects=[],pending=[],listeners=new Map();let cursor=0,tree,account='staff';
 const hooks={
  useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef(value){const i=cursor++;return slots[i]||={current:value};},
  useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}},
 };
 const events={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}},doc={...events,visibilityState:'visible'};
 const exports={},jsx=(type,props)=>({type,props});
 const deps={'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{},'./AdminStaffSecurity.module.css':{default:{}},'@/src/lib/dancr/browser-session':{BROWSER_AUTH_SESSION_KEY:'session'},'./admin-session':{readAdminSession:()=>({account:{id:account}}),requestAdminJson:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}))}};
 vm.runInNewContext(ts.transpileModule(readFileSync('app/admin/AdminStaffSecurity.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Error,document:doc,window:{...events,confirm:()=>true},require:n=>{assert.ok(n in deps,n);return deps[n];}});
 function render(){cursor=0;tree=exports.default({accountId:'staff',children});while(effects.length)effects.shift()();return nodes(tree);}
 render();return {pending,render,text:()=>text(tree),all:()=>nodes(tree),
  submit(index=0){nodes(tree).filter(n=>n.type==='form')[index].props.onSubmit({preventDefault(){}});render();},
  async complete(index,data={userId:'staff',mfaVerified:false,factors:[]}){pending[index].resolve(data);await settle();render();},
  async fail(index){pending[index].reject(new Error('Verification failed.'));await settle();render();},
  input(value){nodes(tree).find(n=>n.type==='input'&&n.props.inputMode==='numeric').props.onChange({target:{value}});render();},
  hide(){doc.visibilityState='hidden';listeners.get('visibilitychange')();render();},
  switchAccount(){account='other';listeners.get('storage')({key:'session'});render();},
  close(){slots.forEach(s=>s?.cleanup?.());},
 };
}
test('private case content mounts only after server-confirmed MFA and hides on session changes',async()=>{
 const f=mount('Private case content');assert.doesNotMatch(f.text(),/Private case/);await f.complete(0);assert.doesNotMatch(f.text(),/Private case/);f.close();
 const verified=mount('Private case content');await verified.complete(0,{userId:'staff',mfaVerified:true,factors:[]});assert.match(verified.text(),/Private case/);verified.switchAccount();assert.doesNotMatch(verified.text(),/Private case/);verified.close();
});
test('enrollment is single-flight, clears secret on hide, and ignores late account-switched results',async()=>{
 const f=mount();await f.complete(0);f.submit();f.submit();assert.equal(f.pending.length,2);
 await f.complete(1,{userId:'staff',enrollment:{id:'factor',qr:'synthetic-qr',secret:'private-setup-key'}});assert.match(f.text(),/private-setup-key/);f.hide();assert.doesNotMatch(f.text(),/private-setup-key/);f.close();
 const stale=mount();await stale.complete(0);stale.submit();stale.switchAccount();assert.equal(stale.pending[1].options.signal.aborted,true);await stale.complete(1,{userId:'staff',enrollment:{id:'factor',qr:'qr',secret:'stale-secret'}});assert.doesNotMatch(stale.text(),/stale-secret/);stale.close();
});
test('failed MFA does not release content and codes clear after submission',async()=>{
 const f=mount('Private case content');await f.complete(0,{userId:'staff',mfaVerified:false,factors:[{id:'factor',name:'Phone',verified:true}]});f.input('123456');f.submit();await f.fail(1);assert.match(f.text(),/Verification failed/);assert.doesNotMatch(f.text(),/Private case/);assert.equal(f.all().find(n=>n.type==='input').props.value,'');f.close();
});
test('MFA step-up preserves the current login while genuine expired sessions still require sign-in',()=>{
 assert.equal(isAdminAuthenticationError(new AdminDataRequestError('Verify authenticator.',403,'MFA_REQUIRED')),false);
 assert.equal(isAdminAuthenticationError(new AdminDataRequestError('Sign in again.',401,'AUTH_REQUIRED')),true);
});
