import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const source = file => readFileSync(file, 'utf8');
const policy = {};
vm.runInNewContext(compile(source('src/lib/dancr/admin-inbox-archive.ts')), { exports: policy, require: () => ({ PublicApiError }) });
const item = { kind: 'support', id: '11111111-1111-4111-8111-111111111111', version: '2026-10-26T01:00:00Z', title: 'Test message' };

test('archive input rejects invalid selections and retains the exact selected revision', () => {
  const parsed=policy.parseInboxArchiveAction({action:'archive',items:[item]});
  assert.equal(parsed.items[0].version,item.version);
  for(const body of [ {action:'delete',items:[item]}, {action:'archive',items:[]}, {action:'archive',items:[item,item]}, {action:'archive',items:[{...item,kind:'venues'}]}, {action:'archive',items:[{...item,version:'bad'}]}, {action:'archive',items:[{...item,id:'bad'}]}, {action:'archive',items:Array(101).fill(item)} ]) assert.throws(()=>policy.parseInboxArchiveAction(body),PublicApiError);
});

function endpoint(role='owner', rpcError=null) {
  const calls=[],exports={};
  const db={ from(table) { calls.push(['table',table]); const chain=new Proxy({}, {get(_target,method) {
    if(method==='then') return resolve=>resolve({data:[],count:0,error:null});
    return (...args)=>{calls.push([method,...args]); return chain;};
  }});return chain; }, async rpc(name,args) { calls.push(['rpc',name,args]); return {data:{changed:1},error:rpcError}; } };
  vm.runInNewContext(compile(source('app/api/admin/inbox-archive/route.ts')), { exports,URL,Error,require(name) {
    if(name==='next/server') return {NextResponse:{json:(data,opts)=>Response.json(data,opts)}};
    if(name.endsWith('/api')) return {PublicApiError,apiError(error,fallback) {const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}};
    if(name.endsWith('/bounded-json-body')) return {readBoundedJsonObject:r=>r.json()};
    if(name.endsWith('/admin-inbox-archive')) return policy;
    if(name.endsWith('dancr/admin')) return {async requireAdmin(_c,_id,scope='owner') {if(role==='none'||(role!=='owner'&&role!==scope))throw new PublicApiError('FORBIDDEN','Denied',403);return role;}};
    if(name.endsWith('supabase/request')) return {async createRequestSupabaseContext(){return {client:{},user:{id:'authenticated-admin'},session:{accessToken:'refreshed'}};}};
    if(name.endsWith('supabase/admin')) return {createAdminSupabaseClient:()=>db};
    assert.fail(name);
  }});
  return {calls,get:(query='')=>exports.GET(new Request('https://example.test/api/admin/inbox-archive'+query)), post:(items=[item])=>exports.POST(new Request('https://example.test/api/admin/inbox-archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'archive',items,adminId:'forged'})}))};
}

test('archive API enforces staff scope and uses the signed-in actor for audited mutations',async()=>{
  const f=endpoint();assert.equal((await f.post()).status,200);
  assert.equal(f.calls[0][2].p_admin_id,'authenticated-admin');
  const denied=endpoint('none');assert.equal((await denied.get()).status,403);assert.equal((await denied.post()).status,403);assert.equal(denied.calls.length,0);
  const support=endpoint('support');assert.equal((await support.get()).status,200);assert.ok(support.calls.some(c=>c[0]==='eq'&&c[1]==='kind'&&c[2]==='support'));
  const nonSupport=endpoint('support');assert.equal((await nonSupport.get('?kind=deal_request')).status,403);assert.equal((await nonSupport.post([{...item,kind:'page_change'}])).status,403);assert.equal(nonSupport.calls.length,0);
});

test('archive API bounds reads and safely reports conflicts without revealing database details',async()=>{
  const f=endpoint(),response=await f.get('?page=2&kind=deal_request');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
  assert.deepEqual(f.calls.find(c=>c[0]==='range'),['range',40,59]);
  for(const query of ['?page=-1','?page=0.1','?page=10001','?kind=anything']) {const bad=endpoint();assert.equal((await bad.get(query)).status,400);assert.equal(bad.calls.length,0);}
  assert.equal((await endpoint('owner',{code:'40001'}).post()).status,409);
  const failure=await endpoint('owner',{code:'XX000',message:'secret details'}).post();assert.equal(failure.status,500);assert.doesNotMatch((await failure.json()).error,/secret details/);
});

const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function mount() {
  const slots=[],effects=[],pending=[],completed=[],events=[];let cursor=0,tree;
  const hooks={useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},useRef(value){const i=cursor++;return slots[i]||=( {current:value});},useEffect(effect,deps){const i=cursor++;if(!slots[i]){slots[i]={deps};effects.push(()=>slots[i].cleanup=effect());}}};
  const exports={},jsx=(type,props)=>({type,props});
  vm.runInNewContext(compile(source('app/admin/AdminInboxActions.tsx')), {exports,AbortController,Error,CustomEvent,window:{dispatchEvent:e=>events.push(e)},require(name){
    if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(name==='./admin-session')return {requestAdminJson:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}))};
    if(name==='./admin-data-events')return {ADMIN_INBOX_ARCHIVE_CHANGED:'archived'};
    if(name.endsWith('.css'))return {default:{}};assert.fail(name);
  }});
  const props={items:[item,{...item,id:'22222222-2222-4222-8222-222222222222',title:'Second'}],onComplete:value=>completed.push(value)};
  const render=()=>{cursor=0;tree=exports.default(props);while(effects.length)effects.shift()();return nodes(tree);};
  render();
  const click=text=>{const button=nodes(tree).find(node=>node.type==='button'&&[node.props.children].flat(Infinity).join('')===text);assert.ok(button,text);button.props.onClick();render();};
  return {props,render,click,pending,completed,events,all:()=>nodes(tree),close:()=>slots.forEach(s=>s?.cleanup?.())};
}

test('archive selection preserves visible items until saved, prevents double submission, and publishes successful changes',async()=>{
  const f=mount();f.click('Archive items…');f.click('Select shown');f.click('Archive selected (2)');
  assert.equal(f.completed.length,0);assert.equal(f.pending.length,1);
  assert.equal(JSON.parse(f.pending[0].options.body).items.length,2);
  f.all().find(n=>n.type==='button'&&n.props.children==='Saving…').props.onClick();assert.equal(f.pending.length,1);
  f.pending[0].resolve({ok:true,changed:2});await settle();f.render();assert.equal(f.completed.length,1);assert.equal(f.events[0].detail.action,'archive');f.close();
});

test('archive failures retain selection; newer activity is not silently selected and unmount cancels updates',async()=>{
  const f=mount();f.click('Archive items…');f.click('Select shown');
  f.props.items=[{...item,version:'2026-10-26T02:00:00Z'}];f.render();f.click('Archive selected (1)');
  assert.equal(JSON.parse(f.pending[0].options.body).items[0].version,item.version);
  f.pending[0].reject(new Error('An item changed. Refresh.'));await settle();f.render();assert.equal(f.completed.length,0);assert.ok(f.all().some(n=>n.props?.role==='alert'));
  f.click('Archive selected (1)');f.close();assert.equal(f.pending[1].options.signal.aborted,true);
  f.pending[1].resolve({ok:true});await settle();assert.equal(f.completed.length,0);
});

test('restore uses the selected archived versions and sends a restore event',async()=>{
  const f=mount(); f.props.action='restore'; f.render(); f.click('Restore items…');
  f.all().find(node=>node.type==='input').props.onChange(); f.render(); f.click('Restore selected (1)');
  const payload=JSON.parse(f.pending[0].options.body);assert.equal(payload.action,'restore');assert.equal(payload.items.length,1);assert.equal(payload.items[0].version,item.version);
  f.pending[0].resolve({ok:true,changed:1});await settle();f.render();assert.equal(f.events[0].detail.action,'restore');f.close();
});
