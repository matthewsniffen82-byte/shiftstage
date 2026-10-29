import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=p=>ts.transpileModule(readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
const walk=n=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(walk)];
const text=n=>typeof n==='string'||typeof n==='number'?String(n):!n||typeof n!=='object'?'':[n.props?.children].flat(Infinity).map(text).join(' ');
function fixture(role='venue',{fail=false,total=2,decided=false}={}){
 let cursor=0,dirty=true,tree,revision=1,submitted=false;
 const slots=[],effects=[],calls=[],counts=[];
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
   const body=JSON.parse(options.body);calls.push(body);if(fail)throw Error('Network failed. Retry.');
   if(body.action==='save'){items.find(x=>x.key===body.key)[role==='venue'?'club':'admin']={decision:body.decision,notes:body.notes};return{id:'batch',revision:String(++revision)};}
   submitted=true;return{id:'batch',state:role==='venue'?'admin':'completed'};
  }
  if(path.includes('batchId=')){const offset=Number(new URL(path,'https://fixture.invalid').searchParams.get('offset'));
   return{batch:{id:'batch',state:role==='venue'?'club':'admin',revision:String(revision),total,
    unreviewed:items.filter(x=>!x[role==='venue'?'club':'admin']).length,items:structuredClone(items.slice(offset,offset+12))}};}
  return{batches:submitted?[]:[{id:'batch',stage_name:'Test dancer',venue_name:'Test club',created_at:'2026-10-29',item_count:total}]};
 };
 const exports={};vm.runInNewContext(compile('app/components/MediaBatchReview.tsx'),{exports,URLSearchParams,AbortController,Date,Error,require:name=>{
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name.includes('session'))return{requestAdminJson:request,requestDashboardJson:request};return{default:'video'};
 }});
 function render(){for(let i=0;dirty&&i<20;i++){dirty=false;cursor=0;tree=exports.default({role,active:true,onCountChange:n=>counts.push(n)});effects.splice(0).forEach(fn=>fn());}assert.equal(dirty,false);return tree;}
 const f={calls,counts,items,render,nodes:()=>walk(render()),button(label){return this.nodes().find(n=>n.type==='button'&&text(n)===label);},
  async settle(){for(let i=0;i<3;i++){await new Promise(r=>setImmediate(r));render();}},
  async open(){await this.settle();this.nodes().find(n=>n.type==='button'&&text(n).includes('Test dancer')).props.onClick();render();await this.settle();},
  async click(label){this.button(label).props.onClick();render();await this.settle();},
  unmount(){slots.forEach(x=>x?.cleanup?.());}};
 render();return f;
}
for(const role of ['venue','admin']){
 test(`${role}: choices persist without removing cards; Submit is the only forwarding action`,async()=>{
  const f=fixture(role);await f.open();assert.equal(f.button('Submit review').props.disabled,true);
  assert.equal(f.nodes().filter(n=>n.type==='article').length,2);
  await f.click('Approve');assert.equal(f.calls[0].action,'save');assert.equal(f.nodes().filter(n=>n.type==='article').length,2);
  const second=f.nodes().filter(n=>n.type==='button'&&text(n)==='Reject')[1];second.props.onClick();await f.settle();
  assert.equal(f.button('Submit review').props.disabled,false);
  await f.click('Refresh');assert.equal(f.nodes().filter(n=>n.type==='button'&&n.props['aria-pressed']===true).length,2);
  const submit=f.button('Submit review');submit.props.onClick();submit.props.onClick();await f.settle();
  assert.equal(f.calls.filter(c=>c.action==='submit').length,1);assert.equal(f.nodes().filter(n=>n.type==='article').length,0);f.unmount();
 });
 test(`${role}: failed submission retains saved choices and supports retry`,async()=>{
  const f=fixture(role,{fail:true,decided:true});await f.open();await f.click('Submit review');
  assert.equal(f.nodes().filter(n=>n.type==='article').length,2);assert.equal(f.button('Submit review').props.disabled,false);
  assert.match(text(f.render()),/Network failed/);f.unmount();
 });
}
test('review choices on later pages are required before final submit',async()=>{
 const f=fixture('venue',{total:13});await f.open();assert.equal(f.nodes().filter(n=>n.type==='article').length,12);
 for(let i=0;i<12;i++){f.nodes().filter(n=>n.type==='button'&&text(n)==='Approve')[i].props.onClick();await f.settle();}
 assert.equal(f.button('Submit review').props.disabled,true);await f.click('Next');assert.equal(f.nodes().filter(n=>n.type==='article').length,1);
 await f.click('Approve');assert.equal(f.button('Submit review').props.disabled,false);f.unmount();
});
test('edited notes must be saved and are included with the final saved choice',async()=>{
 const f=fixture('venue',{decided:true});await f.open();f.nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'Changed note'}});f.render();
 assert.equal(f.button('Submit review').props.disabled,true);await f.click('Approve');assert.equal(f.calls[0].notes,'Changed note');
 assert.equal(f.button('Submit review').props.disabled,false);f.unmount();
});
