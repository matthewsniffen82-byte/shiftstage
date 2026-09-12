import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';
const source=readFileSync(new URL('../src/lib/dancr/venue-publication.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const actor='a2700000-0000-4000-8000-000000090001',venue='a2700000-0000-4000-8000-000000090101';
const valid={id:venue,name:'Synthetic Venue',is_active:true,page_review_status:'published',private_extra:'omit'};
function fixture(result) {
  const exports={},calls=[];
  vm.runInNewContext(code,{exports,Array,Object,require:name=>{assert.equal(name,'../api-error-policy');return {PublicApiError};}});
  const client={rpc:async(name,args)=>{calls.push({name,...args});return typeof result==='function'?result():result;},from(){assert.fail('No direct publication fallback');}};
  return {calls,run:()=>exports.changeVenuePublication(client,actor,venue,'owner_approve',{notes:''},'id,name,is_active,page_review_status')};
}
test('venue publication carries the authenticated actor and exact target into one RPC, retaining only requested fields',async()=>{
  const f=fixture({data:valid,error:null}),data=await f.run();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{name:'change_venue_publication_safely',p_actor_user_id:actor,p_venue_id:venue,p_action:'owner_approve',p_changes:{notes:''}}]);
  assert.deepEqual(JSON.parse(JSON.stringify(data)),{id:venue,name:'Synthetic Venue',is_active:true,page_review_status:'published'});
});
for(const [name,data] of [['null',null],['array',[valid]],['wrong venue',{...valid,id:actor}],['missing name',{...valid,name:undefined}],['missing public flag',{...valid,is_active:undefined}],['string public flag',{...valid,is_active:'true'}],['missing review state',{...valid,page_review_status:undefined}]])test(`venue publication rejects ${name} receipt`,async()=>{
  const f=fixture({data,error:null});await assert.rejects(f.run(),error=>error.status===503);assert.equal(f.calls.length,1);
});
for(const [code,status] of [['42501',403],['22023',400],['40001',409],['PGRST202',503],['SUPABASE_UNAVAILABLE',503],['57014',503]])test(`venue publication ${code} has a bounded error with no old direct write`,async()=>{
  const f=fixture({data:null,error:{code}});await assert.rejects(f.run(),error=>error.status===status);assert.equal(f.calls.length,1);
});
test('venue publication transport failure never initiates compensation',async()=>{
  const f=fixture(()=>{throw new Error('Synthetic connection failure');});await assert.rejects(f.run(),error=>error.status===503);assert.equal(f.calls.length,1);
});
