import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const counts = (requests=0) => Object.fromEntries(['tableRequests','tablePending','tableAcknowledged','tableCompleted','tableCancelled','vipRequests','vipPending','vipConfirmed','vipDeclined','vipCancelled','repeatVips'].map(key=>[key,key==='tableRequests'?requests:0]));
const data = period => ({ period,activeShift:null,periodStart:'2026-10-05T00:00:00Z',periodEnd:'2026-10-12T00:00:00Z',timezone:'UTC',profileCreatedAt:'2026-08-01T00:00:00Z',trend:[{start:'2026-10-05T00:00:00Z',end:'2026-10-06T00:00:00Z',views:3,followers:2,requests:10}],profileViews:{value:3,previous:1},newFollowers:{value:2,previous:null},contentLikes:{value:1,previous:null},socialLinkTaps:{value:0,previous:0},audience:{totalFollowers:20,workingNowSubscribers:12},topContent:[],currentRank:null,
  performance:{current:counts(10),previous:counts(5),external:{claims:2,admissions:1},alerts:{total:12,vip:4},workTrackingStartedAt:'2026-10-10T00:00:00Z',
    clubs:[{id:'club-a',name:'Club A',timezone:'UTC',current:{...counts(3),vipConfirmed:2,vipRequests:2},previous:counts(1),external:{claims:2,admissions:1},vipSubscribers:4},
      {id:'club-b',name:'Club B',timezone:'UTC',current:counts(7),previous:counts(4),external:{claims:0,admissions:0},vipSubscribers:0}],
    shifts:[{id:'shift-a',venueId:'club-a',venueName:'Club A',timezone:'UTC',startedAt:'2026-10-11T00:00:00Z',endedAt:'2026-10-11T03:00:00Z',hours:3,requests:3,partial:true},
      {id:'shift-b',venueId:'club-b',venueName:'Club B',timezone:'UTC',startedAt:'2026-10-11T00:00:00Z',endedAt:'2026-10-11T03:00:00Z',hours:3,requests:7}]}});

// Hook-driven component events with mocked data, never a browser journey.
function fixture(initial=data('7d'), props={}) {
  const slots=[],calls=[];let cursor=0,dirty=true,effects=[],tree;
  const react={
    useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
    useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((value,j)=>!Object.is(value,prior.deps[j])))effects.push(()=>{prior?.cleanup?.();slots[i]={deps,cleanup:effect()};});},
  };
  const imports={react,'react/jsx-runtime':require('react/jsx-runtime'),'./dancer-results.css':{},'./DancerDiscoveryBoosts':{DancerDiscoveryBoosts:()=>null},'./DancerRequestDialog':{DancerRequestDialog:()=>null},
    './dashboard-session':{requestDashboardJson:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))}};
  const trendExports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/dashboard/DancerResultsTrend.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports:trendExports,require});
  imports['./DancerResultsTrend'] = trendExports;
  const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/dashboard/DancerAnalyticsPanel.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports,AbortController,require:name=>{assert.ok(name in imports,name);return imports[name];}});
  function render(){dirty=true;for(let i=0;dirty&&i<20;i++){cursor=0;effects=[];dirty=false;tree=exports.DancerAnalyticsPanel({initialAnalytics:initial,...props});effects.forEach(run=>run());}assert.equal(dirty,false);}
  function nodes(node=tree){return node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)]:[];}
  render();return {calls,nodes,render,setProps(next){props={...props,...next};render();},html:()=>renderToStaticMarkup(tree),button:label=>nodes().find(node=>node.type==='button'&&node.props.children===label),
    async settle(){await new Promise(resolve=>setImmediate(resolve));render();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('audience growth shows only the three supported metrics, even with historical social taps',()=>{
  const initial=data('7d');initial.socialLinkTaps={value:99,previous:50};
  const ui=fixture(initial);
  const growth=ui.nodes().find(node=>node.props?.className==='dancer-analytics-metrics dancer-results-growth');
  assert.deepEqual(Array.from(growth.props.children,node=>node.props.label),['New followers','Profile views','Content likes']);
  assert.doesNotMatch(ui.html(),/Social link taps/);ui.close();
});

test('retired social taps do not hide the empty results state',()=>{
  const initial=data('7d');
  for(const key of ['profileViews','newFollowers','contentLikes'])initial[key]={value:0,previous:0};
  initial.socialLinkTaps={value:99,previous:50};
  initial.performance.current=counts();initial.performance.alerts={total:0,vip:0};
  const ui=fixture(initial);assert.match(ui.html(),/Your results will appear here/);ui.close();
});

test('three growth cards fill the row on desktop without leaving an empty mobile grid cell',()=>{
  const css=readFileSync(new URL('../app/dashboard/dancer-results.css',import.meta.url),'utf8');
  assert.match(css,/\.dancer-results-growth > :last-child \{ grid-column: 1 \/ -1; \}/);
  const desktop=css.slice(css.indexOf('@media (min-width: 860px)'),css.indexOf('@media (max-width: 400px)'));
  assert.match(desktop,/\.dancer-results-growth \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(desktop,/\.dancer-results-growth > :last-child \{ grid-column: auto; \}/);
});

test('club filtering updates request cards and recorded shifts while audience remains explicitly global',()=>{
  const ui=fixture();assert.match(ui.html(),/<strong>10<\/strong>/);
  ui.nodes().find(node=>node.type==='select').props.onChange({target:{value:'club-a'}});ui.render();
  const html=ui.html();assert.match(html,/<strong>3<\/strong>/);assert.doesNotMatch(html,/7 requests/);
  assert.match(html,/Working-alert subscribers<\/dt><dd>12/);assert.match(html,/Current totals across all clubs/);assert.match(html,/VIP alert subscribers at Club A/);
  ui.button('VIP').props.onClick();ui.render();assert.match(ui.html(),/Confirmed<\/dt><dd>2/);
  ui.button('Public site').props.onClick();ui.render();assert.match(ui.html(),/Club entries attributed to you<\/dt><dd>1/);
  assert.equal(ui.calls.length,0);ui.close();
});

test('period changes hide stale results, abort older reads and retain the selected club',async()=>{
  const ui=fixture();ui.nodes().find(node=>node.type==='select').props.onChange({target:{value:'club-b'}});ui.render();
  const periodButton=value=>ui.button(`${value} days`);
  periodButton('30').props.onClick();ui.render();assert.equal(ui.calls.length,1);assert.match(ui.html(),/Loading results/);assert.doesNotMatch(ui.html(),/7 requests/);
  periodButton('7').props.onClick();ui.render();assert.equal(ui.calls[0].options.signal.aborted,true);
  ui.calls[0].resolve({analytics:data('30d')});await ui.settle();
  assert.equal(ui.nodes().find(node=>node.type==='select').props.value,'club-b');assert.match(ui.html(),/<dd>7<\/dd>/);
  periodButton('30').props.onClick();ui.render();ui.calls[1].reject(new Error('No access'));await ui.settle();
  assert.match(ui.html(),/Unable to load results/);assert.doesNotMatch(ui.html(),/Working-alert subscribers/);
  ui.button('Try again').props.onClick();ui.render();ui.calls[2].resolve({analytics:data('30d')});await ui.settle();
  assert.equal(ui.nodes().find(node=>node.type==='select').props.value,'club-b');assert.match(ui.html(),/Working-alert subscribers/);ui.close();
});

test('older cached audience-only payloads refresh instead of inventing missing request counts',()=>{
  const initial=data('7d');delete initial.performance;const ui=fixture(initial);
  assert.equal(ui.calls.length,1);assert.match(ui.html(),/Loading results/);assert.doesNotMatch(ui.html(),/Table requests/);ui.close();
});

test('Tonight loads its own results, updates headings and hides prior-period comparisons',async()=>{
  const ui=fixture();
  const group=ui.nodes().find(node=>node.props?.['aria-label']==='Analytics period');
  assert.deepEqual(Array.from(group.props.children,button=>button.props.children),['Tonight','7 days','30 days','All time']);
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

test('All time keeps the club selection, uses its own dates and never shows a prior-period comparison',async()=>{
  const ui=fixture();ui.nodes().find(node=>node.type==='select').props.onChange({target:{value:'club-a'}});ui.render();
  ui.button('All time').props.onClick();ui.render();
  assert.equal(ui.calls[0].url,'/api/dancer/analytics?period=all');
  const all=data('all');all.periodStart=all.profileCreatedAt;
  ui.calls[0].resolve({analytics:all});await ui.settle();
  assert.equal(ui.nodes().find(node=>node.type==='select').props.value,'club-a');
  assert.match(ui.html(),/Aug 1, 2026/);assert.match(ui.html(),/All recorded activity/);
  assert.doesNotMatch(ui.html(),/vs prior|No change|Last 7 days/);ui.close();
});

test('shift rows show per-hour comparisons, mark partial recording and avoid rates for tiny durations',()=>{
  const initial=data('7d');initial.performance.shifts[1].hours=0;
  const ui=fixture(initial),html=ui.html();
  assert.match(html,/Partial recording/);assert.match(html,/Req\/hr<\/dt><dd>1.0/);
  assert.match(html,/Req\/hr<\/dt><dd>—/);assert.doesNotMatch(html,/Infinity|NaN/);ui.close();
});

test('top content expands progressively and resets on a range change',()=>{
  const initial=data('7d');initial.topContent=Array.from({length:6},(_,i)=>({id:`photo-${i}`,kind:'photo',label:`Content ${i+1}`,thumbnailUrl:null,likes:10-i,views:null}));
  const ui=fixture(initial);assert.match(ui.html(),/Content 3/);assert.doesNotMatch(ui.html(),/Content 4/);
  ui.button('Show more content').props.onClick();ui.render();assert.match(ui.html(),/Content 6/);
  assert.equal(ui.button('Show more content'),undefined);
  ui.button('30 days').props.onClick();ui.render();ui.button('7 days').props.onClick();ui.render();
  assert.doesNotMatch(ui.html(),/Content 4/);assert.ok(ui.button('Show more content'));ui.close();
});

test('chart switches between recorded metrics, with accessible numbers for empty and single-point series',()=>{
  const ui=fixture();
  const chart=ui.nodes().find(node=>node.props?.onMetricChange);
  chart.props.onMetricChange('requests');ui.render();assert.match(ui.html(),/Requests trend across all clubs: 10 total/);
  chart.props.onMetricChange('followers');ui.render();assert.match(ui.html(),/Followers trend across all clubs: 2 total/);
  assert.match(ui.html(),/View chart numbers/);assert.doesNotMatch(ui.html(),/NaN|Infinity/);ui.close();
  const initial=data('7d');initial.trend[0].views=0;
  const zero=fixture(initial);assert.match(zero.html(),/Views trend across all clubs: 0 total, peak 0/);zero.close();
});

const checkedIn = () => {
  const result=data('shift');
  result.activeShift={id:'live-shift',venueId:'club-a',venueName:'Club A',startedAt:'2026-10-11T23:30:00Z',expiresAt:'2026-10-12T05:30:00Z'};
  result.periodStart=result.activeShift.startedAt;
  result.performance.current=counts(3);
  result.performance.clubs=result.performance.clubs.slice(0,1);
  result.performance.shifts=result.performance.shifts.slice(0,1);
  return result;
};

test('request cards open owned details with the selected snapshot, club and pending filter',()=>{
  const initial=checkedIn();initial.performance.clubs[0].current.tablePending=2;
  const ui=fixture(initial);
  const table=ui.nodes().find(node=>node.props?.label==='Table requests'&&node.props?.onView);
  assert.equal(table.props.pendingCount,2);
  assert.match(ui.html(),/View 2 pending table requests/);
  table.props.onView(true);ui.render();
  let dialog=ui.nodes().find(node=>node.props?.window);
  assert.deepEqual(JSON.parse(JSON.stringify(dialog.props.window)),{channel:'internal',pending:true,since:initial.periodStart,until:initial.periodEnd,venueId:'club-a',label:'This shift so far · Club A'});
  dialog.props.onClose();ui.render();assert.equal(ui.nodes().some(node=>node.props?.window),false);
  ui.nodes().find(node=>node.props?.label==='VIP requests'&&node.props?.onView).props.onView(false);ui.render();
  dialog=ui.nodes().find(node=>node.props?.window);assert.equal(dialog.props.window.channel,'vip');assert.equal(dialog.props.window.pending,false);
  ui.close();
  const all=fixture();all.nodes().find(node=>node.type==='select').props.onChange({target:{value:'club-b'}});all.render();
  all.nodes().find(node=>node.props?.label==='Table requests'&&node.props?.onView).props.onView(false);all.render();
  assert.equal(all.nodes().find(node=>node.props?.window).props.window.venueId,'club-b');all.close();
});

test('shift caption appears once, pending is actionable and count buttons do not contain info controls',()=>{
  const initial=checkedIn();initial.performance.clubs[0].current.vipPending=1;
  const ui=fixture(initial),html=ui.html();
  assert.equal(html.match(/This shift so far/g)?.length,1);
  assert.match(html,/View 1 pending vip requests/);
  const card=ui.nodes().find(node=>node.props?.label==='VIP requests'&&node.props?.onView);
  const element=card.type(card.props),children=element.props.children.flat(Infinity).filter(Boolean);
  assert.equal(children.filter(node=>node.type==='button').length,2);
  assert.equal(children.filter(node=>node.type==='button').some(node=>[node.props.children].flat(Infinity).some(child=>child?.type==='details'||child?.type==='button')),false);
  assert.ok(children.some(node=>typeof node.type==='function'&&node.props.label==='VIP requests'));ui.close();
});

test('checked-in dashboards default to actual shift dates and the current club',()=>{
  const ui=fixture(checkedIn());
  assert.equal(ui.calls.length,0);
  assert.equal(ui.button('This shift').props['aria-pressed'],true);
  assert.equal(ui.button('Tonight'),undefined);
  const club=ui.nodes().find(node=>node.type==='select');
  assert.equal(club.props.value,'club-a');assert.equal(club.props.disabled,true);
  assert.match(ui.html(),/Since check-in/);assert.match(ui.html(),/This shift so far/);
  assert.doesNotMatch(ui.html(),/vs prior|No change/);ui.close();
  const compact=fixture(checkedIn(),{compact:true});
  assert.match(compact.html(),/Your shift/);assert.match(compact.html(),/This shift · Club A/);
  assert.match(compact.html(),/<dd>3<\/dd>/);compact.close();
});

test('ending a shift fetches fresh seven-day activity instead of reusing the opening snapshot',async()=>{
  const ui=fixture(data('7d'),{compact:true});
  ui.setProps({presenceKey:'live-shift'});
  assert.equal(ui.calls[0].url,'/api/dancer/analytics?period=auto');
  ui.calls[0].resolve({analytics:checkedIn()});await ui.settle();
  assert.match(ui.html(),/Your shift/);
  ui.setProps({presenceKey:'off'});
  assert.equal(ui.calls[1].url,'/api/dancer/analytics?period=auto');
  assert.doesNotMatch(ui.html(),/<dd>3<\/dd>/);
  const latest=data('7d');latest.performance.current=counts(18);
  ui.calls[1].resolve({analytics:latest});await ui.settle();
  assert.match(ui.html(),/Last 7 days · all clubs/);assert.match(ui.html(),/<dd>18<\/dd>/);ui.close();
});

test('manual ranges remain selectable while checked in and shift expiry returns seven days',async()=>{
  const ui=fixture(checkedIn());
  ui.button('30 days').props.onClick();ui.render();
  assert.ok(ui.button('This shift'));
  const month=data('30d');month.activeShift=checkedIn().activeShift;
  ui.calls[0].resolve({analytics:month});await ui.settle();
  assert.equal(ui.nodes().find(node=>node.type==='select').props.disabled,false);
  ui.button('This shift').props.onClick();ui.render();
  ui.setProps({presenceKey:'off'});
  ui.calls.at(-1).resolve({analytics:data('7d')});await ui.settle();
  assert.equal(ui.button('7 days').props['aria-pressed'],true);
  assert.ok(ui.button('Tonight'));assert.doesNotMatch(ui.html(),/This shift so far/);ui.close();
});

test('incorrect period responses never display under a new selection',async()=>{
  const ui=fixture();ui.button('All time').props.onClick();ui.render();
  ui.calls[0].resolve({analytics:data('7d')});await ui.settle();
  assert.match(ui.html(),/Unable to load results/);assert.doesNotMatch(ui.html(),/Oct 5, 2026/);ui.close();
});


test('compact sticky controls keep date details outside the pinned box and collapse same-day ranges',async()=>{
  const ui=fixture();ui.button('Tonight').props.onClick();ui.render();
  const tonight=data('tonight');tonight.timezone='America/Los_Angeles';
  tonight.periodStart='2026-10-17T07:01:00Z';tonight.periodEnd='2026-10-18T03:00:00Z';
  ui.calls[0].resolve({analytics:tonight});await ui.settle();
  const toolbar=ui.nodes().find(node=>node.props?.className==='dancer-analytics-toolbar');
  assert.equal(ui.nodes(toolbar).filter(node=>node.type==='button').length,4);
  assert.equal(ui.nodes(toolbar).find(node=>node.type==='select').props['aria-label'],'Club for requests and shifts');
  assert.equal(ui.nodes(toolbar).find(node=>node.props?.className==='dancer-results-range'),undefined);
  const range=()=>renderToStaticMarkup(ui.nodes().find(node=>node.props?.className==='dancer-results-range'));
  assert.equal(range().match(/Oct 17, 2026/g)?.length,1);
  assert.match(range(),/PDT · so far/);assert.doesNotMatch(range(),/ – /);
  ui.button('30 days').props.onClick();ui.render();
  const month=data('30d');month.timezone='America/Los_Angeles';
  month.periodStart='2026-10-17T07:01:00Z';month.periodEnd='2026-11-16T09:00:00Z';
  ui.calls[1].resolve({analytics:month});await ui.settle();
  assert.match(range(),/Oct 17, 2026 – Nov 16, 2026/);assert.match(range(),/>PST</);
  assert.doesNotMatch(range(),/so far/);ui.close();
});
