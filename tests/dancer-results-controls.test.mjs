import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const counts = (requests=0) => Object.fromEntries(['tableRequests','tablePending','tableAcknowledged','tableCompleted','tableCancelled','vipRequests','vipPending','vipConfirmed','vipDeclined','vipCancelled','repeatVips'].map(key=>[key,key==='tableRequests'?requests:0]));
const data = period => ({ period,profileViews:{value:3,previous:1},newFollowers:{value:2,previous:null},contentLikes:{value:1,previous:null},socialLinkTaps:{value:0,previous:0},audience:{totalFollowers:20,workingNowSubscribers:12},topContent:[],currentRank:null,
  performance:{current:counts(10),previous:counts(5),external:{claims:2,admissions:1},alerts:{total:12,vip:4},workTrackingStartedAt:'2026-10-10T00:00:00Z',
    clubs:[{id:'club-a',name:'Club A',timezone:'UTC',current:{...counts(3),vipConfirmed:2,vipRequests:2},previous:counts(1),external:{claims:2,admissions:1},vipSubscribers:4},
      {id:'club-b',name:'Club B',timezone:'UTC',current:counts(7),previous:counts(4),external:{claims:0,admissions:0},vipSubscribers:0}],
    shifts:[{id:'shift-a',venueId:'club-a',venueName:'Club A',timezone:'UTC',startedAt:'2026-10-11T00:00:00Z',endedAt:'2026-10-11T03:00:00Z',hours:3,requests:3},
      {id:'shift-b',venueId:'club-b',venueName:'Club B',timezone:'UTC',startedAt:'2026-10-11T00:00:00Z',endedAt:'2026-10-11T03:00:00Z',hours:3,requests:7}]}});

// Hook-driven component events with mocked data, never a browser journey.
function fixture(initial=data('7d')) {
  const slots=[],calls=[];let cursor=0,dirty=true,effects=[],tree;
  const react={
    useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
    useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((value,j)=>!Object.is(value,prior.deps[j])))effects.push(()=>{prior?.cleanup?.();slots[i]={deps,cleanup:effect()};});},
  };
  const imports={react,'react/jsx-runtime':require('react/jsx-runtime'),'./dancer-results.css':{},'./DancerDiscoveryBoosts':{DancerDiscoveryBoosts:()=>null},
    './dashboard-session':{requestDashboardJson:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))}};
  const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/dashboard/DancerAnalyticsPanel.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports,AbortController,require:name=>{assert.ok(name in imports,name);return imports[name];}});
  function render(){dirty=true;for(let i=0;dirty&&i<20;i++){cursor=0;effects=[];dirty=false;tree=exports.DancerAnalyticsPanel({initialAnalytics:initial});effects.forEach(run=>run());}assert.equal(dirty,false);}
  function nodes(node=tree){return node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)]:[];}
  render();return {calls,nodes,render,html:()=>renderToStaticMarkup(tree),button:label=>nodes().find(node=>node.type==='button'&&node.props.children===label),
    async settle(){await new Promise(resolve=>setImmediate(resolve));render();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('club filtering updates request cards and recorded shifts while audience remains explicitly global',()=>{
  const ui=fixture();assert.match(ui.html(),/<strong>10<\/strong>/);
  ui.nodes().find(node=>node.type==='select').props.onChange({target:{value:'club-a'}});ui.render();
  const html=ui.html();assert.match(html,/<strong>3<\/strong>/);assert.doesNotMatch(html,/7 requests/);
  assert.match(html,/12<\/strong>/);assert.match(html,/current total across all clubs/);assert.match(html,/VIP alert subscribers at Club A/);
  ui.button('VIP').props.onClick();ui.render();assert.match(ui.html(),/Confirmed<\/dt><dd>2/);
  ui.button('External').props.onClick();ui.render();assert.match(ui.html(),/Club entries attributed to you<\/dt><dd>1/);
  assert.equal(ui.calls.length,0);ui.close();
});

test('period changes hide stale results, abort older reads and retain the selected club',async()=>{
  const ui=fixture();ui.nodes().find(node=>node.type==='select').props.onChange({target:{value:'club-b'}});ui.render();
  const periodButton=value=>ui.button(`${value} days`);
  periodButton('30').props.onClick();ui.render();assert.equal(ui.calls.length,1);assert.match(ui.html(),/Loading results/);assert.doesNotMatch(ui.html(),/7 requests/);
  periodButton('7').props.onClick();ui.render();assert.equal(ui.calls[0].options.signal.aborted,true);
  ui.calls[0].resolve({analytics:data('30d')});await ui.settle();
  assert.equal(ui.nodes().find(node=>node.type==='select').props.value,'club-b');assert.match(ui.html(),/7 requests/);
  periodButton('30').props.onClick();ui.render();ui.calls[1].reject(new Error('No access'));await ui.settle();
  assert.match(ui.html(),/Unable to load results/);assert.doesNotMatch(ui.html(),/Working alerts/);
  ui.button('Try again').props.onClick();ui.render();ui.calls[2].resolve({analytics:data('30d')});await ui.settle();
  assert.equal(ui.nodes().find(node=>node.type==='select').props.value,'club-b');assert.match(ui.html(),/Working alerts/);ui.close();
});

test('older cached audience-only payloads refresh instead of inventing missing request counts',()=>{
  const initial=data('7d');delete initial.performance;const ui=fixture(initial);
  assert.equal(ui.calls.length,1);assert.match(ui.html(),/Loading results/);assert.doesNotMatch(ui.html(),/Table requests/);ui.close();
});

test('Tonight loads its own results, updates headings and hides prior-period comparisons',async()=>{
  const ui=fixture();
  const group=ui.nodes().find(node=>node.props?.['aria-label']==='Analytics period');
  assert.deepEqual(Array.from(group.props.children,button=>button.props.children),['Tonight','7 days','30 days']);
  ui.button('Tonight').props.onClick();ui.render();
  assert.equal(ui.calls[0].url,'/api/dancer/analytics?period=tonight');
  assert.equal(ui.button('Tonight').props['aria-pressed'],true);
  assert.match(ui.html(),/Loading results/);
  assert.doesNotMatch(ui.html(),/Table requests/);
  const tonight=data('tonight');tonight.performance.current=counts(2);
  ui.calls[0].resolve({analytics:tonight});await ui.settle();
  const html=ui.html();
  assert.match(html,/Your results: Tonight/);
  assert.match(html,/Tonight so far/);
  assert.match(html,/All clubs · Tonight/);
  assert.doesNotMatch(html,/Last 7 days|Last 30 days|vs prior|No change/);
  ui.button('7 days').props.onClick();ui.render();
  assert.match(ui.html(),/Last 7 days/);assert.equal(ui.calls.length,1);ui.close();
});
