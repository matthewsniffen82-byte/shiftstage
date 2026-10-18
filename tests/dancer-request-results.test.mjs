import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = path => ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class PublicApiError extends Error { constructor(code,message,status){super(message);Object.assign(this,{code,status});} }
const service={};
vm.runInNewContext(compile('src/lib/dancr/dancer-request-results.ts'),{exports:service,require:name=>({'server-only':{},'../api-error-policy':{PublicApiError}}[name])});
const params = overrides => new URLSearchParams({channel:'internal',since:'2026-10-05T00:00:00.000Z',until:'2026-10-12T00:00:00.000Z',...overrides});
const query = overrides => service.parseDancerRequestQuery(params(overrides),Date.parse('2026-10-17T00:00:00Z'));
const row = (index=1) => ({id:String(index),created_at:'2026-10-11T23:55:00Z',status:'pending',starts_at:'2026-10-13T01:00:00Z',timezone:'America/Los_Angeles',venues:{name:'Echo House',timezone:'America/Los_Angeles'},internal_roster_links:{label:'Table 12',token:'secret'},guest_name:'Private guest',notes:'Private notes',user_id:'private-id',dancers:[{id:'other-dancer'}]});
function db({rows=[row()],profile={id:'owned-dancer'},profileError=null,error=null}={}) {
  const calls=[];
  return {calls,from(table){const call={table,ops:[]};calls.push(call);const builder={};
    for(const name of ['select','eq','contains','gte','lt','order','range'])builder[name]=(...args)=>{call.ops.push([name,...args]);return builder;};
    builder.maybeSingle=async()=>({data:profile,error:profileError});
    builder.then=(resolve,reject)=>Promise.resolve({data:rows,error}).then(resolve,reject);
    return builder;
  }};
}

test('table reads derive dancer ownership and retain the exact analytics window, club and pending filter',async()=>{
  const admin=db(),venueId='00000000-0000-0000-0000-000000000001';
  const result=await service.getOwnDancerRequests(admin,'verified-user',query({venueId,pending:'true',dancerId:'someone-else'}));
  assert.deepEqual(Array.from(admin.calls[0].ops[1]),['eq','user_id','verified-user']);
  const calls=JSON.parse(JSON.stringify(admin.calls[1]));
  assert.equal(calls.table,'internal_roster_requests');
  for(const operation of [['eq','dancer_id','owned-dancer'],['gte','created_at','2026-10-05T00:00:00.000Z'],['lt','created_at','2026-10-12T00:00:00.000Z'],['eq','venue_id',venueId],['eq','status','pending'],['range',0,20]])assert.ok(calls.ops.some(op=>JSON.stringify(op)===JSON.stringify(operation)),JSON.stringify(operation));
  assert.equal(result.items[0].label,'Table 12');assert.equal(result.items[0].startsAt,null);
  assert.doesNotMatch(JSON.stringify(result),/secret|private|Private|other-dancer/);
});

test('VIP filters use JSONB containment for the owner and never select guest or other dancer information',async()=>{
  const admin=db();const result=await service.getOwnDancerRequests(admin,'verified-user',query({channel:'vip'}));
  const request=admin.calls[1];assert.equal(request.table,'venue_vip_requests');
  const contains=request.ops.find(op=>op[0]==='contains');assert.equal(contains[1],'dancers');
  assert.equal(contains[2],JSON.stringify([{id:'owned-dancer'}]));
  assert.doesNotMatch(request.ops[0][1],/guest_name|user_id|notes|dancers|\*/);
  assert.equal(result.items[0].label,'VIP visit');assert.equal(result.items[0].startsAt,'2026-10-13T01:00:00Z');
  assert.doesNotMatch(JSON.stringify(result),/Private|private|other-dancer|secret/);
  assert.equal(request.ops.some(op=>op[0]==='eq'&&op[1]==='status'),false);
});

test('bounded pagination uses deterministic ordering and an extra row without exposing it',async()=>{
  const admin=db({rows:Array.from({length:21},(_,i)=>row(i))});
  const result=await service.getOwnDancerRequests(admin,'verified-user',query({offset:'20'}));
  assert.equal(result.items.length,20);assert.equal(result.nextOffset,40);
  assert.deepEqual(JSON.parse(JSON.stringify(admin.calls[1].ops.slice(-3))),[['order','created_at',{ascending:false}],['order','id',{ascending:false}],['range',20,40]]);
  const last=await service.getOwnDancerRequests(db({rows:[row()]}),'verified-user',query({offset:'40'}));
  assert.equal(last.nextOffset,null);
});

test('errors and missing ownership fail closed instead of reporting zero requests',async()=>{
  const missing=db({profile:null});
  await assert.rejects(service.getOwnDancerRequests(missing,'user',query()),e=>e.status===404);assert.equal(missing.calls.length,1);
  const failed=db({profileError:Error('profile unavailable')});
  await assert.rejects(service.getOwnDancerRequests(failed,'user',query()),/profile unavailable/);assert.equal(failed.calls.length,1);
  await assert.rejects(service.getOwnDancerRequests(db({error:Error('requests unavailable')}),'user',query()),/requests unavailable/);
});

test('invalid filters are rejected and all-time ranges remain supported',()=>{
  for(const invalid of [{channel:'external'},{since:'bad'},{until:'bad'},{until:'2099-01-01T00:00:00Z'},{since:'2026-10-12T00:00:00Z'},{venueId:'other-club'},{pending:'yes'},{offset:'-1'},{offset:'1.5'},{offset:'1000000'}])assert.throws(()=>query(invalid),e=>e.status===400,JSON.stringify(invalid));
  assert.equal(query({since:'2020-01-01T00:00:00Z'}).since,'2020-01-01T00:00:00.000Z');
});

test('route authenticates the dancer before privileged reads and marks responses private',async()=>{
  const calls=[],exports={};let authError=null;
  const imports={
    'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
    '@/src/lib/api':{apiError:error=>({status:error.status||500})},
    '@/src/lib/dancr/dancer-request-results':{parseDancerRequestQuery:service.parseDancerRequestQuery,getOwnDancerRequests:async(admin,userId,request)=>{calls.push(['read',admin,userId,request]);return {items:[],nextOffset:null};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>{calls.push(['admin']);return 'admin';}},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(_request,options)=>{calls.push(['auth',options.role]);if(authError)throw authError;return {user:{id:'verified-user'}};}},
  };
  vm.runInNewContext(compile('app/api/dancer/requests/route.ts'),{exports,URL,require:name=>{assert.ok(name in imports,name);return imports[name];}});
  const response=await exports.GET({url:'https://example.invalid/api/dancer/requests?'+params({userId:'attacker',dancerId:'someone-else'})});
  assert.equal(response.headers['Cache-Control'],'private, no-store');
  assert.deepEqual(calls.slice(0,2),[['auth','dancer'],['admin']]);assert.equal(calls[2][2],'verified-user');
  calls.length=0;authError={status:401};assert.equal((await exports.GET({url:'https://example.invalid/'})).status,401);assert.deepEqual(calls,[['auth','dancer']]);
  calls.length=0;authError=null;assert.equal((await exports.GET({url:'https://example.invalid/?channel=bad'})).status,400);assert.deepEqual(calls,[['auth','dancer']]);
});
