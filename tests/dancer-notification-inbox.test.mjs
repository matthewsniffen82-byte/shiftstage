import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/dashboard/DashboardShared.tsx',import.meta.url),'utf8');
const panel = source.slice(source.indexOf('export function NotificationPanel('),source.indexOf('export function SupportInboxPanel('));
const compile = code => ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick = () => new Promise(resolve=>setImmediate(resolve));
function fixture(dancerMode=true, props={}, notifications=[]) {
  const effects=[],listeners=new Map(),calls=[],timers=new Map(),cleanups=[],exports={};
  const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const window={addEventListener:document.addEventListener,removeEventListener:document.removeEventListener,
    setInterval:(fn,ms)=>{assert.equal(ms,15000);timers.set(1,fn);return 1;},clearInterval:id=>timers.delete(id)};
  let respond=async()=>({notifications:[]});
  vm.runInNewContext(compile(panel),{exports,window,document,AbortController,
    useState:initial=>[Array.isArray(initial)?notifications:initial,()=>{}],useRef:current=>({current}),useCallback:fn=>fn,useEffect:effect=>effects.push(effect),
    Link:'a',NotificationIcon:'NotificationIcon',pickupNotificationHref:()=>'',notificationCategory:()=> 'Account',formatNotificationTimestamp:()=> 'Today',
    requestDashboardJson:async(path,options)=>{calls.push({path,options});return respond();},
    require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
  });
  const tree=exports.NotificationPanel({dancerMode,...props});
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

test('dancer rejection notice links to the affected editor and marks the notice read',async()=>{
 const notice={id:'media-rejected',title:'Main photo needs replacing',payload:{kind:'dancer_media_rejected',emailPath:'/dashboard/dancer#dancer-main-photo'}};
 const f=fixture(true,{},[notice]);await tick();
 const nodes=tree=>tree&&typeof tree==='object'?[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)]:[];
 const link=nodes(f.tree).find(n=>n.props?.href==='/dashboard/dancer#dancer-main-photo');assert.ok(link);
 link.props.onClick({});await tick();assert.ok(f.calls.some(c=>c.options.method==='PATCH'));f.unmount();
});
test('venue review notifications open the approval section while marking the notification read',async()=>{
  const notice={id:'review-1',title:'Your venue page is ready to review',payload:{event:'venue_page_review'},readAt:null};
  let opened=false,prevented=false;
  const f=fixture(false,{onVenueReview:event=>{event.preventDefault();opened=true;}},[notice]);
  await tick();
  const nodes=tree=>tree&&typeof tree==='object'?[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)]:[];
  const link=nodes(f.tree).find(n=>n.props?.href==='/dashboard/venue#venue-publication');
  assert.equal(link.type,'a');
  f.setResponse(async()=>({notification:{readAt:'2026-10-27'},notifications:[]}));
  link.props.onClick({preventDefault(){prevented=true;}});await tick();
  assert.equal(opened,true);assert.equal(prevented,true);
  const update=f.calls.find(c=>c.options.method==='PATCH');
  assert.deepEqual(JSON.parse(update.options.body),{notificationId:'review-1'});
  f.unmount();
});
test('table requests are categorized as table requests, not support messages',()=>{
  const start=source.indexOf('function notificationCategory('),end=source.indexOf('function formatNotificationTimestamp(',start),exports={};
  vm.runInNewContext(compile(source.slice(start,end)+'\nexport { notificationCategory };'),{exports});
  assert.equal(exports.notificationCategory({type:'support_message',payload:{kind:'dancer_table_request'}}),'Table request');
  assert.equal(exports.notificationCategory({type:'support_message',payload:{}}),'Support');
});

// Exercise rendered inbox state and events without a browser or network.
function interactiveInbox(props={dancerMode:true}) {
  const slots=[],calls=[],exports={}; let cursor=0,effects=[],dirty=true,tree;
  const slot = initial => { const index=cursor++; slots[index]??={value:initial}; return slots[index]; };
  const dependenciesChanged = (prior,deps) => !prior || deps.some((value,index)=>!Object.is(value,prior.deps[index]));
  const document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  const window={addEventListener(){},removeEventListener(){},setInterval(){return 1;},clearInterval(){}};
  vm.runInNewContext(compile(panel),{exports,window,document,AbortController,Error,
    useState(initial){const state=slot(initial);return [state.value,next=>{const value=typeof next==='function'?next(state.value):next;if(!Object.is(value,state.value)){state.value=value;dirty=true;}}];},
    useRef(current){return slot({current}).value;},
    useCallback(callback,deps){const index=cursor++;if(dependenciesChanged(slots[index],deps))slots[index]={value:callback,deps};return slots[index].value;},
    useEffect(effect,deps){const index=cursor++,prior=slots[index];if(dependenciesChanged(prior,deps))effects.push(()=>{prior?.cleanup?.();slots[index]={deps,cleanup:effect()};});},
    Link:'a',NotificationIcon:'NotificationIcon',pickupNotificationHref:()=>'',customerNotificationHref:()=>'',notificationCategory:()=> 'VIP',formatNotificationTimestamp:()=> 'Today',homeDiscoveryHref:()=> '/',
    requestDashboardJson:(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject})),
    require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),
  });
  const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[];
  const text=node=>typeof node==='string'?node:typeof node==='number'?String(node):node&&typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):'';
  function render(){dirty=true;for(let i=0;dirty&&i<20;i++){cursor=0;effects=[];dirty=false;tree=exports.NotificationPanel(props);effects.forEach(run=>run());}assert.equal(dirty,false);}
  render();
  return {calls,render,text:()=>text(tree),button:name=>nodes(tree).find(node=>node.type==='button'&&text(node)===name),
    rows:()=>nodes(tree).filter(node=>node.props?.className?.startsWith('notification-row')&&!node.props.className.startsWith('notification-row-meta')),
    async settle(){await tick();render();},close(){slots.forEach(state=>state?.cleanup?.());}};
}

test('older dancer VIP and table alerts can be revealed and marked read individually',async()=>{
  const ui=interactiveInbox();
  const notices=Array.from({length:13},(_,index)=>({id:`notice-${index}`,title:index===12?'Older table request':`VIP notice ${index}`,body:'Request details',readAt:null}));
  ui.calls[0].resolve({notifications:notices});await ui.settle();
  assert.equal(ui.rows().length,6);assert.doesNotMatch(ui.text(),/Older table request/);
  ui.button('Show more notifications').props.onClick();ui.render();assert.equal(ui.rows().length,12);
  ui.button('Show more notifications').props.onClick();ui.render();assert.equal(ui.rows().length,13);
  assert.equal(ui.button('Show more notifications'),undefined);
  ui.rows().at(-1).props.onClick();ui.render();
  assert.deepEqual(JSON.parse(ui.calls[1].options.body),{notificationId:'notice-12'});
  assert.equal(ui.calls[1].options.method,'PATCH');
  ui.calls[1].resolve({notification:{readAt:'2026-10-31T07:15:00Z'}});await ui.settle();
  assert.equal(ui.rows().at(-1).props.className,'notification-row read');
  ui.close();
});

test('notification loading and errors do not claim an empty inbox; retry recovers',async()=>{
  const ui=interactiveInbox();
  assert.match(ui.text(),/Loading notifications/);assert.doesNotMatch(ui.text(),/No notifications yet/);
  ui.calls[0].reject(new Error('Inbox temporarily unavailable'));await ui.settle();
  assert.match(ui.text(),/Inbox temporarily unavailable/);assert.doesNotMatch(ui.text(),/No notifications yet|Loading notifications/);
  ui.button('Retry notifications').props.onClick();ui.render();
  assert.match(ui.text(),/Loading notifications/);assert.doesNotMatch(ui.text(),/Inbox temporarily unavailable/);
  ui.calls[1].resolve({notifications:[]});await ui.settle();
  assert.match(ui.text(),/No notifications yet/);assert.doesNotMatch(ui.text(),/Loading notifications/);ui.close();
});

test('customer inbox keeps its ten-alert pages',async()=>{
  const ui=interactiveInbox({customerMode:true});
  ui.calls[0].resolve({notifications:Array.from({length:21},(_,id)=>({id,title:`Alert ${id}`}))});await ui.settle();
  assert.equal(ui.rows().length,10);
  ui.button('Show more alerts').props.onClick();ui.render();assert.equal(ui.rows().length,20);
  ui.button('Show more alerts').props.onClick();ui.render();assert.equal(ui.rows().length,21);
  assert.equal(ui.button('Show more alerts'),undefined);ui.close();
});
