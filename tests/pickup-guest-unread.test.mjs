import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { pickupUuid } from '../src/lib/dancr/pickup-validation.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

const id = '96000000-0000-4000-8000-000000000020', key = 'a'.repeat(64);
const compile = file => ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;

test('guest unread API bounds and hashes private links before a scoped read, and never caches the result', async () => {
  const server = {}, route = {}, calls = [];
  vm.runInNewContext(compile('src/lib/dancr/pickup-guest-server.ts'), { exports:server, require(name) {
    if(name==='server-only')return {};
    if(name==='node:crypto')return {createHash};
    if(name.endsWith('/supabase/admin'))return {createAdminSupabaseClient:()=>({})};
    if(name.endsWith('/api-error-policy'))return {PublicApiError};
    if(name.endsWith('/request-client-address'))return {};
    if(name.endsWith('/pickup-validation'))return {pickupUuid};
    if(name.endsWith('/pickup-server'))return {pickupRpc:async(client,name,args)=>{calls.push({name,args});return 8;}};
    throw Error(name);
  }});
  vm.runInNewContext(compile('app/api/pickups/guest-unread/route.ts'), {exports:route, require(name){
    if(name==='next/server')return {NextResponse:{json:Response.json}};
    if(name.endsWith('/api'))return {apiError:error=>Response.json({ok:false,error:error.message},{status:error.status||500})};
    if(name.endsWith('/api-error-policy'))return {PublicApiError};
    if(name.endsWith('/bounded-json-body'))return {readBoundedJsonObject};
    if(name.endsWith('/pickup-guest-server'))return server;
    throw Error(name);
  }});
  const request = (body,headers={}) => route.POST(new Request('https://example.test/api/pickups/guest-unread', {
    method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body),
  }));
  const response=await request({links:[{id,key}]});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,unreadCount:8});
  assert.match(response.headers.get('cache-control'),/private, no-store/);
  assert.equal(calls[0].name,'pickup_guest_unread_count');
  assert.equal(calls[0].args.p_links[0].key_hash,createHash('sha256').update(key).digest('hex'));
  assert.ok(!JSON.stringify(calls).includes(key));
  const invalid=[{}, {links:{}}, {links:[null]}, {links:[{id,key:'bad'}]}, {links:[{id:'bad',key}]}, {links:[{id,key},{id,key}]}, {links:Array(51).fill({id,key})}, {links:[{id,key,customerId:id}]}, {links:[],extra:true}, 'bad json'];
  for(const body of invalid){const failed=await request(body);assert.equal(failed.status,400);assert.match(failed.headers.get('cache-control'),/no-store/);}
  assert.equal((await request('x'.repeat(12289))).status,413);
  assert.equal((await request({links:[{id,key}]},{authorization:'Bearer invalid'})).status,401);
  assert.equal(calls.length,1,'invalid requests never reach the database');
  assert.deepEqual(await (await request({links:[]})).json(),{ok:true,unreadCount:0});
});

const source=readFileSync(new URL('../outputs/index.html',import.meta.url),'utf8');
function declaration(name){const start=source.indexOf(`    ${name.startsWith('refresh')?'async ':''}function ${name}(`);assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n    }',start)+6);}
function fixture(){
  const attrs={},link={hidden:true,setAttribute:(k,v)=>attrs[k]=v},badge={hidden:true,textContent:''};
  const storage=new Map([['mydancrGuestPickupsV1',JSON.stringify([{id,key,venue:'Test Club',savedAt:Date.now()}])]]);
  const requests=[];
  let answer=()=>Promise.resolve(Response.json({ok:true,unreadCount:3}));
  const context=vm.createContext({Date,AbortController,setTimeout,clearTimeout,authSession:null,
    document:{visibilityState:'visible',getElementById:name=>name==='guestPickupNav'?link:badge},
    localStorage:{getItem:name=>storage.get(name)},fetch:(url,options)=>{requests.push({url,options});return answer();},
  });
  vm.runInContext('let guestPickupUnreadState={signature:"",links:[],count:null,checkedAt:0,controller:null};'+['savedGuestPickupNavLinks','renderGuestPickupUnreadCount','refreshGuestPickupUnreadCount','renderGuestPickupNav'].map(declaration).join('\n'),context);
  return {context,link,badge,attrs,storage,requests,respond:fn=>{answer=fn;},render:force=>context.renderGuestPickupNav(force)};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('homepage badge totals, clears, caps visual text, and stays visible with zero unread replies',async()=>{
  const f=fixture();f.render();await settle();
  assert.equal(f.link.hidden,false);assert.equal(f.badge.textContent,'3');
  assert.match(f.attrs['aria-label'],/3 unread venue messages/);
  assert.equal(f.requests[0].url,'/api/pickups/guest-unread');
  assert.equal(f.requests[0].options.credentials,'omit');
  assert.equal(f.requests[0].options.cache,'no-store');
  f.render();await settle();assert.equal(f.requests.length,1,'repeated renders do not duplicate polling');
  f.respond(()=>Promise.resolve(Response.json({ok:true,unreadCount:0})));f.render(true);await settle();
  assert.equal(f.badge.hidden,true);assert.equal(f.link.hidden,false);
  f.respond(()=>Promise.resolve(Response.json({ok:true,unreadCount:123})));f.render(true);await settle();
  assert.equal(f.badge.textContent,'99+');assert.match(f.attrs['aria-label'],/123 unread/);
  f.respond(()=>Promise.reject(Error('Offline')));f.render(true);await settle();
  assert.equal(f.badge.hidden,true);assert.equal(f.link.hidden,false);
});

test('homepage ignores stale requests after chat removal, sign-in and newer read receipts; hidden tabs do not poll',async()=>{
  const f=fixture();let resolve;
  f.respond(()=>new Promise(done=>{resolve=done;}));f.render();
  f.render();assert.equal(f.requests.length,1);
  f.storage.clear();f.render();resolve(Response.json({ok:true,unreadCount:8}));await settle();
  assert.equal(f.link.hidden,true);assert.equal(f.badge.hidden,true);assert.equal(f.requests[0].options.signal.aborted,true);
  const g=fixture();g.context.document.visibilityState='hidden';g.render();assert.equal(g.requests.length,0);
  g.context.document.visibilityState='visible';g.respond(()=>new Promise(done=>{resolve=done;}));g.render();
  g.context.authSession={accessToken:'synthetic'};g.render();resolve(Response.json({ok:true,unreadCount:9}));await settle();
  assert.equal(g.link.hidden,true);assert.equal(g.badge.hidden,true);
  const h=fixture();h.respond(()=>new Promise(done=>{resolve=done;}));h.render();
  h.respond(()=>Promise.resolve(Response.json({ok:true,unreadCount:0})));h.render(true);await settle();
  resolve(Response.json({ok:true,unreadCount:7}));await settle();assert.equal(h.badge.hidden,true);
});

test('a successful guest read notifies other tabs without storing any private chat key',()=>{
  const exports={},writes=[],events=[];
  vm.runInNewContext(compile('src/lib/dancr/pickup-guest-session.ts'),{exports,Event,
    localStorage:{setItem:(...args)=>writes.push(args)},window:{dispatchEvent:event=>events.push(event.type)},
  });
  exports.notifyGuestPickupRead();
  assert.equal(writes[0][0],'mydancrGuestPickupReadV1');assert.match(writes[0][1],/^\d+$/);
  assert.deepEqual(events,['mydancr:guest-pickup-read']);
});
