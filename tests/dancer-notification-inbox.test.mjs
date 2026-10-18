import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/dashboard/DashboardShared.tsx',import.meta.url),'utf8');
const panel = source.slice(source.indexOf('export function NotificationPanel('),source.indexOf('export function SupportInboxPanel('));
const compile = code => ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick = () => new Promise(resolve=>setImmediate(resolve));
function fixture(dancerMode=true) {
  const effects=[],listeners=new Map(),calls=[],timers=new Map(),cleanups=[],exports={};
  const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const window={addEventListener:document.addEventListener,removeEventListener:document.removeEventListener,
    setInterval:(fn,ms)=>{assert.equal(ms,15000);timers.set(1,fn);return 1;},clearInterval:id=>timers.delete(id)};
  let respond=async()=>({notifications:[]});
  vm.runInNewContext(compile(panel),{exports,window,document,AbortController,
    useState:initial=>[initial,()=>{}],useRef:current=>({current}),useCallback:fn=>fn,useEffect:effect=>effects.push(effect),
    requestDashboardJson:async(path,options)=>{calls.push({path,options});return respond();},
    require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
  });
  const tree=exports.NotificationPanel({dancerMode});
  for(const effect of effects)cleanups.push(effect());
  return {tree,document,listeners,calls,timers,setResponse:fn=>{respond=fn;},unmount:()=>cleanups.forEach(fn=>fn?.())};
}
test('dancer inbox has a focusable deep link, refreshes on focus/visibility and pauses while the phone is hidden',async()=>{
  const f=fixture(); await tick();
  assert.equal(f.tree.props.id,'dancer-notifications'); assert.equal(f.tree.props.tabIndex,-1);
  assert.equal(f.calls.length,1); f.timers.get(1)(); await tick(); assert.equal(f.calls.length,2);
  f.document.visibilityState='hidden'; f.timers.get(1)(); await tick(); assert.equal(f.calls.length,2);
  f.document.visibilityState='visible'; f.listeners.get('visibilitychange')(); await tick(); assert.equal(f.calls.length,3);
  f.listeners.get('focus')(); await tick(); assert.equal(f.calls.length,4);
  f.unmount(); assert.equal(f.timers.size,0); assert.equal(f.listeners.size,0);
});
test('polling does not overlap an in-flight inbox fetch and unmount aborts it',async()=>{
  const f=fixture(); await tick(); let resolve;
  f.setResponse(()=>new Promise(done=>{resolve=done;}));
  f.timers.get(1)(); f.timers.get(1)(); f.listeners.get('focus')();
  assert.equal(f.calls.length,2);
  const {signal}=f.calls.at(-1).options; f.unmount(); assert.equal(signal.aborted,true);
  resolve({notifications:[]}); await tick();
});
test('other dashboard inboxes retain their existing refresh behavior',async()=>{
  const f=fixture(false); await tick(); assert.equal(f.timers.size,0); assert.equal(f.calls.length,1); f.unmount();
});
test('table requests are categorized as table requests, not support messages',()=>{
  const start=source.indexOf('function notificationCategory('),end=source.indexOf('function formatNotificationTimestamp(',start),exports={};
  vm.runInNewContext(compile(source.slice(start,end)+'\nexport { notificationCategory };'),{exports});
  assert.equal(exports.notificationCategory({type:'support_message',payload:{kind:'dancer_table_request'}}),'Table request');
  assert.equal(exports.notificationCategory({type:'support_message',payload:{}}),'Support');
});
