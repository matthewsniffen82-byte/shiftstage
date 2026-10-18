import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const require=createRequire(import.meta.url);
const range={channel:'internal',since:'2026-10-17T01:00:00Z',until:'2026-10-17T05:00:00Z',venueId:'club-a',label:'This shift so far · Echo House',pending:false};
const item={id:'request-1',label:'Table 12',venueName:'Echo House',createdAt:'2026-10-17T03:30:00Z',startsAt:null,timezone:'America/Los_Angeles',status:'pending'};
function fixture(overrides={}) {
  const slots=[],calls=[];let cursor=0,dirty=true,effects=[],tree,closed=0,opened=0,restored=0;
  const dialog={showModal(){opened++;},close(){closed++;}};
  class Element {isConnected=true;focus(){restored++;}}
  const trigger=new Element();
  const hooks={
    useState(initial){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
    useRef(){const i=cursor++;slots[i]??={value:{current:dialog}};return slots[i].value;},
    useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((value,j)=>!Object.is(value,prior.deps[j])))effects.push(()=>{prior?.cleanup?.();slots[i]={deps,cleanup:effect()};});},
  };
  const imports={react:hooks,'react/jsx-runtime':require('react/jsx-runtime'),'./dashboard-session':{requestDashboardJson:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))}};
  const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/dashboard/DancerRequestDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URLSearchParams,AbortController,document:{activeElement:trigger},HTMLElement:Element,require:name=>{assert.ok(name in imports,name);return imports[name];}});
  let dismissals=0;
  function render(){dirty=true;for(let i=0;dirty&&i<20;i++){cursor=0;effects=[];dirty=false;tree=exports.DancerRequestDialog({window:{...range,...overrides},onClose:()=>dismissals++});effects.forEach(run=>run());}assert.equal(dirty,false);}
  function nodes(node=tree){return node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)]:[];}
  render();return {calls,nodes,render,html:()=>renderToStaticMarkup(tree),button:label=>nodes().find(node=>node.type==='button'&&node.props.children===label),stats:()=>({opened,closed,restored,dismissals}),
    async settle(){await new Promise(resolve=>setImmediate(resolve));render();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('dialog reads the snapshot filters and shows safe table labels, current statuses and local request time',async()=>{
  const ui=fixture({pending:true});
  const url=new URL(ui.calls[0].url,'https://example.invalid');
  for(const key of ['channel','since','until','venueId'])assert.equal(url.searchParams.get(key),range[key]);
  assert.equal(url.searchParams.get('pending'),'true');assert.equal(ui.calls[0].options.expectedRole,'dancer');
  assert.equal(ui.stats().opened,1);assert.match(ui.html(),/Loading requests/);
  ui.calls[0].resolve({items:[item],nextOffset:null});await ui.settle();
  const html=ui.html();assert.match(html,/Table 12/);assert.match(html,/Echo House/);assert.match(html,/Pending/);assert.match(html,/Oct 16, 2026/);assert.match(html,/PDT/);
  assert.doesNotMatch(html,/NaN|Invalid Date/);assert.equal(ui.button('Next').props.disabled,true);ui.close();
  assert.equal(ui.stats().restored,1);assert.equal(ui.stats().closed,1);assert.equal(ui.calls[0].options.signal.aborted,true);
});

test('changing status aborts stale reads and never flashes the previous filter results',async()=>{
  const ui=fixture();ui.button('Pending').props.onClick();ui.render();assert.equal(ui.calls[0].options.signal.aborted,true);
  ui.calls[0].resolve({items:[{...item,label:'Stale request'}],nextOffset:null});await ui.settle();assert.doesNotMatch(ui.html(),/Stale request/);
  ui.calls[1].resolve({items:[],nextOffset:null});await ui.settle();assert.match(ui.html(),/No pending requests/);
  ui.button('All').props.onClick();ui.render();assert.match(ui.html(),/Loading requests/);assert.doesNotMatch(ui.html(),/No pending requests/);ui.close();
});

test('pagination resets for a new filter, and unavailable requests show a retry instead of empty results',async()=>{
  const ui=fixture();ui.calls[0].resolve({items:[item],nextOffset:20});await ui.settle();
  ui.button('Next').props.onClick();ui.render();assert.match(ui.calls[1].url,/offset=20/);assert.equal(ui.button('Next').props.disabled,true);
  ui.calls[1].reject(Error('service unavailable'));await ui.settle();assert.match(ui.html(),/Unable to load requests/);assert.doesNotMatch(ui.html(),/No requests/);
  ui.button('Retry').props.onClick();ui.render();ui.calls[2].resolve({items:[{...item,id:'request-2',label:'Table 14'}],nextOffset:null});await ui.settle();
  assert.match(ui.html(),/Table 14/);assert.doesNotMatch(ui.html(),/Table 12/);assert.match(ui.html(),/Page 2/);
  ui.button('Pending').props.onClick();ui.render();assert.match(ui.calls[3].url,/offset=0/);assert.match(ui.html(),/Page 1/);ui.close();
});

test('VIP requests show the visit separately from submission, and Escape and close both dismiss',async()=>{
  const ui=fixture({channel:'vip'});ui.calls[0].resolve({items:[{...item,label:'VIP visit',status:'confirmed',startsAt:'2026-10-18T03:00:00Z'}],nextOffset:null});await ui.settle();
  assert.match(ui.html(),/VIP visit/);assert.match(ui.html(),/Confirmed/);assert.match(ui.html(),/Requested <time/);assert.match(ui.html(),/Visit <time/);
  let prevented=false;ui.nodes()[0].props.onCancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  ui.button('Close').props.onClick();assert.equal(ui.stats().dismissals,2);ui.close();
});

test('a pending page emptied by staff decisions does not claim that the whole period is empty',async()=>{
  const ui=fixture({pending:true});ui.calls[0].resolve({items:[item],nextOffset:20});await ui.settle();
  ui.button('Next').props.onClick();ui.render();ui.calls[1].resolve({items:[],nextOffset:null});await ui.settle();
  assert.match(ui.html(),/No requests on this page/);assert.doesNotMatch(ui.html(),/No pending requests in this period/);
  assert.equal(ui.button('Previous').props.disabled,false);ui.button('Previous').props.onClick();ui.render();assert.match(ui.calls[2].url,/offset=0/);ui.close();
});
