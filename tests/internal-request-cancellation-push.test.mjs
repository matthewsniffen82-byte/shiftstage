import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

function fixture({status='cancelled',active=true,failSave=false}={}) {
 const source=ts.transpileModule(readFileSync(new URL('../src/lib/dancr/internal-request-cancellation-push.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const saved=new Map(),delivered=[],checks=[],api={};
 const tables={internal_roster_requests:[{id:'request',status,venue_id:'venue',link_id:'table',dancer_id:'dancer'}],
  venues:[{id:'venue',owner_user_id:'owner',is_active:active}],internal_roster_links:[{id:'table',venue_id:'venue',label:'Table 4'}],
  dancer_profiles:[{id:'dancer',stage_name:'Aster'}],venue_team_members:[
   {venue_id:'venue',user_id:'staff',status:'active',role:'staff'},
   {venue_id:'venue',user_id:'disabled-user',status:'active',role:'staff'},
   {venue_id:'venue',user_id:'removed',status:'removed',role:'staff'},
   {venue_id:'foreign',user_id:'other-club',status:'active',role:'manager'},
  ]};
 const client={
  from(table){let rows=tables[table]||[];const q={select(){return q},eq(k,v){rows=rows.filter(row=>row[k]===v);return q},in(k,v){rows=rows.filter(row=>v.includes(row[k]));return q},maybeSingle:async()=>({data:rows[0],error:null}),then:resolve=>Promise.resolve({data:rows,error:null}).then(resolve),upsert:async(row,options)=>{
   assert.equal(table,'notifications');assert.equal(options.ignoreDuplicates,true);
   if(failSave)return {error:Error('Database unavailable')};if(!saved.has(row.id))saved.set(row.id,row);return {error:null};
  }};return q;},
  rpc:async(name,args)=>{assert.equal(name,'internal_roster_access');assert.equal(args.p_venue,'venue');checks.push(args.p_actor);return {data:['owner','staff'].includes(args.p_actor),error:null};},
 };
 vm.runInNewContext(source,{exports:api,require:name=>name==='node:crypto'?{createHash}:name==='./notification-delivery'?{deliverNotificationRows:async(_client,rows,options)=>{assert.equal(options.email,false);delivered.push(...rows);}}:{}});
 return {saved,delivered,checks,run:()=>api.deliverInternalCancellationPush(client,'request')};
}

test('cancellation alerts target only active staff at the request venue and persist without table capabilities',async()=>{
 const f=fixture();await f.run();
 assert.deepEqual(f.delivered.map(row=>row.recipient_id),['owner','staff']);
 assert.equal(f.saved.size,2);
 for(const row of f.saved.values()) {
  assert.equal(row.body,'Table 4 cancelled the request for Aster.');
  assert.equal(row.payload.kind,'internal_table_request');assert.equal(row.payload.event,'cancelled');
  assert.doesNotMatch(JSON.stringify(row),/token|request_key|storage_path/);
 }
 await f.run();assert.equal(f.saved.size,2);
 assert.deepEqual(f.delivered.slice(0,2).map(row=>row.deliveryId),f.delivered.slice(2).map(row=>row.deliveryId),'Device delivery retries keep their existing receipt IDs');
});
for(const options of [{status:'pending'},{status:'completed'},{active:false}])test('no cancellation alert for '+JSON.stringify(options),async()=>{
 const f=fixture(options);await f.run();assert.equal(f.saved.size,0);assert.equal(f.delivered.length,0);
});
test('failed inbox persistence cannot send an unrecorded cancellation push',async()=>{
 const f=fixture({failSave:true});await assert.rejects(f.run(),/Database unavailable/);assert.equal(f.delivered.length,0);
});
