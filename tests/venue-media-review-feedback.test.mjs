import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { refreshButtonModule } from './helpers/refresh-button.mjs';
import { createReviewPreviewCache } from '../src/lib/review-preview-cache.ts';
const compile=p=>ts.transpileModule(readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>type===refreshButtonModule.default?type(props):({type,props});
const walk=n=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(walk)];
const text=n=>typeof n==='string'||typeof n==='number'?String(n):!n||typeof n!=='object'?'':[n.props?.children].flat(Infinity).map(text).join(' ');
function fixture(role='venue',{fail=false,total=2,decided=false,active=true,venueId,returnedVenueId=venueId,twoBatches=false}={}){
 let cursor=0,dirty=true,tree,revision=1,submitted=false;
 let batchId='batch';
 let pendingCount=total,readFailure=false,pauseReads=false,pauseWrites=false;
 const readFailures=[],heldReads=[],heldWrites=[],writes=[];
 const slots=[],effects=[],calls=[],counts=[],reads=[],timers=new Set(),listeners=new Map();
 const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const window={setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),addEventListener:document.addEventListener,removeEventListener:document.removeEventListener};
 const props={role,active,venueId,onCountChange:n=>counts.push(n)};
 const items=Array.from({length:total},(_,i)=>({key:'photo:'+i,kind:i===1?'video':'photo',label:i===0?'Main photo':'Photo',previewUrl:'/media/'+i,posterUrl:'/poster',editable:true,
  club:role==='admin'||decided?{decision:'approved',notes:'Saved note'}:null,admin:role==='admin'&&decided?{decision:'approved',notes:''}:null}));
 const hooks={
  useState(initial){const i=cursor++;const slot=slots[i]||={value:initial};return[slot.value,next=>{slot.value=typeof next==='function'?next(slot.value):next;dirty=true;}];},
  useRef(initial){return slots[cursor++]||={current:initial};},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,n)=>d!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,n)=>d!==old.deps[n]))slots[i]={deps,fn};return slots[i].fn;},
 };
 const request=async(path,options={})=>{
  if(options.method==='POST'){
   writes.push(options);
   if(pauseWrites)await new Promise((resolve,reject)=>{heldWrites.push(resolve);options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
   const body=JSON.parse(options.body);calls.push(body);if(fail)throw Error('Network failed. Retry.');
   if(body.action==='save'){items.find(x=>x.key===body.key)[role==='venue'?'club':'admin']={decision:body.decision,notes:body.notes};return{id:'batch',revision:String(++revision)};}
   if(twoBatches && batchId==='batch')batchId='second-batch';else submitted=true;
   return{id:body.batchId,state:role==='venue'?'admin':'completed'};
  }
  reads.push({path,signal:options.signal,timeoutMs:options.timeoutMs});
  if(pauseReads)await new Promise((resolve,reject)=>{heldReads.push(resolve);options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
  if(options.signal?.aborted)throw options.signal.reason;
  if(readFailures.length)throw readFailures.shift();
  if(readFailure)throw Error('Counts unavailable. Retry.');
  if(new URL(path,'https://fixture.invalid').searchParams.get('dancerId')==='another-dancer')return {venueId:returnedVenueId,batches:[]};
  if(path.includes('countOnly=1'))return{count:submitted?0:pendingCount,venueId:returnedVenueId};
  if(path.includes('batchId=')){const offset=Number(new URL(path,'https://fixture.invalid').searchParams.get('offset'));
   return{batch:{id:batchId,state:role==='venue'?'club':'admin',revision:String(revision),total,
    unreviewed:items.filter(x=>!x[role==='venue'?'club':'admin']).length,items:structuredClone(items.slice(offset,offset+12))}};}
  const summary={id:batchId,stage_name:'Test dancer',venue_name:'Test club',created_at:'2026-10-29',item_count:pendingCount};
  return{venueId:returnedVenueId,batches:submitted?[]:twoBatches&&batchId==='batch'?[summary,{...summary,id:'second-batch'}]:[summary]};
 };
 const exports={};vm.runInNewContext(compile('app/components/MediaBatchReview.tsx'),{exports,URLSearchParams,AbortController,Date,Error,TypeError,window,document,require:name=>{
  if(name==='./RefreshButton')return refreshButtonModule;
  if(name==='@/src/lib/review-preview-cache')return {createReviewPreviewCache};
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name.includes('session'))return{requestAdminJson:request,requestDashboardJson:request};return{default:'video'};
 }});
 function render(){for(let i=0;dirty&&i<20;i++){dirty=false;cursor=0;tree=exports.default(props);effects.splice(0).forEach(fn=>fn());}assert.equal(dirty,false);return tree;}
 const f={calls,counts,items,reads,writes,timers,listeners,render,nodes:()=>walk(render()),button(label){return this.nodes().find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));},
  update(next){Object.assign(props,next);dirty=true;render();},
  setPendingCount(next){pendingCount=next;},failReads(next){readFailure=next;},
  failNextReads(...errors){readFailures.push(...errors);},
  holdReads(){pauseReads=true;},releaseReads(){pauseReads=false;heldReads.splice(0).forEach(resolve=>resolve());},
  holdWrites(){pauseWrites=true;},releaseWrites(){pauseWrites=false;heldWrites.splice(0).forEach(resolve=>resolve());},
  async tick(){for(const fn of timers)fn();await this.settle();},
  async visibility(next){document.visibilityState=next;listeners.get('visibilitychange')?.();await this.settle();},
  async settle(){for(let i=0;i<3;i++){await new Promise(r=>setImmediate(r));render();}},
  async open(){await this.settle();this.nodes().find(n=>n.type==='button'&&text(n).includes('Test dancer')).props.onClick();render();await this.settle();},
  async click(label){this.button(label).props.onClick();render();await this.settle();},
  unmount(){slots.forEach(x=>x?.cleanup?.());}};
 render();return f;
}
test('normal login counts unopened media updates and agrees with an email-opened review tab',async()=>{
 const normal=fixture('venue',{active:false,total:13,venueId:'club'}),email=fixture('venue',{total:13,venueId:'club'});
 await normal.settle();await email.settle();
 assert.equal(normal.render(),null);assert.deepEqual(normal.counts,[13]);assert.deepEqual(normal.counts,email.counts);
 assert.equal(normal.reads.length,1);assert.match(normal.reads[0].path,/countOnly=1/);
 assert.doesNotMatch(email.reads[0].path,/countOnly/);
 normal.update({active:true});await normal.open();
 assert.equal(normal.timers.size,0);assert.equal(normal.nodes().filter(n=>n.type==='article').length,12);
 normal.unmount();email.unmount();
});
test('opening one dancer goes directly to their items and submitting advances to the next batch',async()=>{
 const f=fixture('venue',{twoBatches:true,decided:true});
 f.update({dancerId:'test-dancer'});await f.settle();
 assert.equal(f.nodes().filter(n=>n.type==='article').length,2);
 assert.equal(f.nodes().some(n=>n.props?.['aria-label']==='Dancer media batches'),false);
 assert.ok(f.reads.some(r=>r.path.includes('dancerId=test-dancer')));
 await f.click('Submit review');
 assert.deepEqual(f.calls.map(c=>c.batchId),['batch']);
 assert.ok(f.reads.some(r=>r.path.includes('batchId=second-batch')));
 assert.equal(f.nodes().filter(n=>n.type==='article').length,2);
 await f.click('Submit review');
 assert.deepEqual(f.calls.map(c=>c.batchId),['batch','second-batch']);
 assert.match(text(f.render()),/No submitted media waiting for review/);f.unmount();
});
test('closed-tab totals refresh without dashboard refreshes, retain good counts on errors, and pause while hidden',async()=>{
 const f=fixture('venue',{active:false,total:13});await f.settle();
 f.failReads(true);await f.tick();assert.equal(f.counts.at(-1),13);
 f.failReads(false);f.setPendingCount(14);await f.tick();assert.equal(f.counts.at(-1),14);
 await f.visibility('hidden');const before=f.reads.length;await f.tick();assert.equal(f.reads.length,before);
 f.setPendingCount(0);await f.visibility('visible');assert.equal(f.counts.at(-1),0);
 f.unmount();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
});
test('a count from a different club is never shown on this club dashboard',async()=>{
 const f=fixture('venue',{active:false,total:13,venueId:'club',returnedVenueId:'different'});await f.settle();
 assert.deepEqual(f.counts,[]);f.update({active:true});await f.settle();
 assert.match(text(f.render()),/Your club changed/);assert.deepEqual(f.counts,[]);f.unmount();
});

test('media reads have a deadline and recover after a timed-out attempt',async()=>{
 const f=fixture('venue',{active:false,total:13});await f.settle();
 assert.equal(f.reads[0].timeoutMs,15000);
 f.failNextReads(Object.assign(new Error('Loading took too long. Please try again.'),{status:408}));
 f.setPendingCount(9);await f.tick();assert.equal(f.counts.at(-1),9);
 assert.equal(f.reads.length,3);assert.ok(f.reads.every(read=>read.timeoutMs===15000));
 await f.tick();assert.equal(f.reads.length,4,'timeout releases the count poll');f.unmount();
});
for(const role of ['venue','admin']){
 test(`${role}: choices persist without removing cards; Submit is the only forwarding action`,async()=>{
  const f=fixture(role);await f.open();assert.equal(f.button('Submit review').props.disabled,true);
  const initialReads=f.reads.length;
  assert.equal(f.nodes().filter(n=>n.type==='article').length,2);
  await f.click('Approve');assert.equal(f.calls[0].action,'save');assert.equal(f.nodes().filter(n=>n.type==='article').length,2);
  assert.equal(f.button('Approved').props['aria-pressed'],true);
  const second=f.nodes().filter(n=>n.type==='button'&&text(n)==='Reject')[1];second.props.onClick();await f.settle();
  assert.equal(f.button('Submit review').props.disabled,false);
  assert.equal(f.reads.length,initialReads,'the final saved choice enables Submit without a refresh');
  await f.click('Refresh media batches');assert.equal(f.nodes().filter(n=>n.type==='button'&&n.props['aria-pressed']===true).length,2);
  assert.equal(f.button('Approved').props['aria-pressed'],true);assert.equal(f.button('Rejected').props['aria-pressed'],true);
  const submit=f.button('Submit review');submit.props.onClick();submit.props.onClick();await f.settle();
  assert.equal(f.calls.filter(c=>c.action==='submit').length,1);assert.equal(f.nodes().filter(n=>n.type==='article').length,0);f.unmount();
 });
 test(`${role}: submitting has a clear disabled progress state and prevents duplicate submissions`,async()=>{
  const f=fixture(role,{decided:true});await f.open();f.holdWrites();
  const submit=f.button('Submit review');submit.props.onClick();f.render();
  assert.equal(f.button('Submitting…').props.disabled,true);
  submit.props.onClick();assert.equal(f.writes.length,1);
  f.releaseWrites();await f.settle();assert.equal(f.calls.filter(c=>c.action==='submit').length,1);f.unmount();
 });
 test(`${role}: failed submission retains saved choices and supports retry`,async()=>{
  const f=fixture(role,{fail:true,decided:true});await f.open();await f.click('Submit review');
  assert.equal(f.nodes().filter(n=>n.type==='article').length,2);assert.equal(f.button('Submit review').props.disabled,false);
  assert.match(text(f.render()),/Network failed/);f.unmount();
  assert.equal(f.calls.length,1,'a failed submission is never automatically repeated');
 });
}
test('review choices on later pages are required before final submit',async()=>{
 const f=fixture('venue',{total:13});await f.open();assert.equal(f.nodes().filter(n=>n.type==='article').length,12);
 for(let i=0;i<12;i++)await f.click('Approve');
 assert.equal(f.button('Submit review').props.disabled,true);await f.click('Next');assert.equal(f.nodes().filter(n=>n.type==='article').length,1);
 await f.click('Approve');assert.equal(f.button('Submit review').props.disabled,false);f.unmount();
});
test('decision controls preserve existing notes without showing note editors or saved-status text',async()=>{
 const f=fixture('venue',{decided:true});await f.open();
 assert.equal(f.nodes().some(n=>n.type==='textarea'||n.type==='details'),false);
 assert.doesNotMatch(text(f.render()),/Review notes|Saved: approved/);
 await f.click('Reject');assert.equal(f.calls[0].notes,'Saved note');
 assert.equal(f.button('Rejected').props['aria-pressed'],true);
 assert.equal(f.button('Submit review').props.disabled,false);f.unmount();
});

test('a transient queue read retries once and preserves saved decisions',async()=>{
 const f=fixture('venue',{decided:true});await f.open();const before=f.reads.length;
 f.failNextReads(new Error("We couldn't load this right now. Check your connection and try again."));
 await f.click('Refresh media batches');
 assert.equal(f.reads.length-before,3,'retry the list once, then load the selected batch');
 assert.equal(f.nodes().filter(n=>n.props?.role==='alert').length,0);
 assert.equal(f.nodes().filter(n=>n.type==='button'&&n.props['aria-pressed']===true).length,2);
 assert.equal(f.button('Refresh media batches').props['aria-busy'],false);f.unmount();
});

test('persistent read failure stops the spinner; refreshing clears the error without losing saved choices',async()=>{
 const f=fixture('venue',{decided:true});await f.open();
 const before=f.reads.length;f.failNextReads(new TypeError('Failed to fetch'),new TypeError('Failed to fetch'));
 await f.click('Refresh media batches');assert.equal(f.reads.length-before,2);
 assert.equal(f.button('Refresh media batches').props.disabled,false);
 assert.equal(f.button('Refresh media batches').props['aria-busy'],false);
 assert.equal(f.nodes().filter(n=>n.props?.role==='alert').length,1);
 f.holdReads();f.button('Refresh media batches').props.onClick();f.render();
 assert.equal(f.nodes().filter(n=>n.props?.role==='alert').length,0);
 assert.equal(f.button('Refresh media batches').props['aria-busy'],true);
 assert.doesNotMatch(text(f.render()),/Loading batches/);
 assert.equal(f.button('Approved').props['aria-pressed'],true);
 assert.equal(f.button('Approved').props['data-refresh-disabled'],true);
 assert.equal(f.button('Submit review').props['data-refresh-disabled'],true);
 assert.equal(f.button('Approved').props.disabled,true,'refresh cannot race a saved decision');
 assert.equal(f.button('Previous').props['data-refresh-disabled'],undefined,'unavailable navigation stays disabled visually');
 f.releaseReads();await f.settle();
 assert.equal(f.button('Refresh media batches').props['aria-busy'],false);
 assert.equal(f.button('Approved').props['aria-pressed'],true);
 assert.equal(f.button('Submit review').props.disabled,false);f.unmount();
});

test('authorization failures are not retried and canceled reads cannot clear a newer refresh',async()=>{
 const f=fixture();await f.open();const before=f.reads.length;
 f.failNextReads(Object.assign(new Error('Sign in required.'),{status:401}));
 await f.click('Refresh media batches');assert.equal(f.reads.length-before,1);
 f.holdReads();f.button('Refresh media batches').props.onClick();f.render();
 const first=f.reads.at(-1);f.update({refreshKey:'new'});await f.settle();
 assert.equal(first.signal.aborted,true);
 assert.equal(f.button('Refresh media batches').props['aria-busy'],true);
 f.releaseReads();await f.settle();
 assert.equal(f.button('Refresh media batches').props['aria-busy'],false);
 assert.equal(f.nodes().filter(n=>n.props?.role==='alert').length,0);f.unmount();
});

test('a failed next-page read cannot expose the previous page as the next twelve items',async()=>{
 const f=fixture('venue',{total:13,decided:true});await f.open();
 const oldApprove=f.button('Approved');f.failReads(true);await f.click('Next');
 assert.match(text(f.render()),/Counts unavailable/);
 assert.equal(f.nodes().filter(n=>n.type==='article').length,0,'page one must not remain actionable under page two');
 assert.equal(f.button('Submit review'),undefined);
 oldApprove.props.onClick();await f.settle();assert.equal(f.calls.length,0,'a stale page callback cannot mutate the old page');
 f.failReads(false);await f.click('Refresh media batches');
 assert.equal(f.nodes().filter(n=>n.type==='article').length,1);assert.match(text(f.render()),/13\s*–\s*13\s+of\s+13/);f.unmount();
});

test('changing the dancer filter hides previous review data even if the new queue cannot load',async()=>{
 const f=fixture('venue',{decided:true});await f.open();const oldSubmit=f.button('Submit review');
 f.failReads(true);f.update({dancerId:'another-dancer'});await f.settle();
 assert.equal(f.nodes().filter(n=>n.type==='article').length,0);
 assert.equal(f.button('Submit review'),undefined);
 oldSubmit.props.onClick();await f.settle();assert.equal(f.calls.length,0);f.unmount();
});

test('changing review scope aborts a pending save and cannot apply its result to the next queue',async()=>{
 const f=fixture();await f.open();const busy=[];f.update({onBusyChange:value=>busy.push(value)});
 f.holdWrites();f.button('Approve').props.onClick();f.render();
 assert.equal(busy.at(-1),true);f.update({dancerId:'another-dancer'});await f.settle();
 assert.equal(f.writes[0].signal.aborted,true);assert.equal(busy.at(-1),false);
 f.releaseWrites();await f.settle();
 assert.doesNotMatch(text(f.render()),/Decision saved/);
 assert.equal(f.nodes().filter(n=>n.type==='article').length,0);f.unmount();
});

test('unmounting a pending review releases the parent navigation lock',async()=>{
 const f=fixture();await f.open();const busy=[];f.update({onBusyChange:value=>busy.push(value)});
 f.holdWrites();f.button('Approve').props.onClick();f.render();assert.equal(busy.at(-1),true);
 f.unmount();assert.equal(f.writes[0].signal.aborted,true);assert.equal(busy.at(-1),false);await f.settle();
});
