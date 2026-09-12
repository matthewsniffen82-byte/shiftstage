import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {isPublicDancerProfileEligible} from '../src/lib/dancr/profile-approval.ts';
import {isPublicVenueRow} from '../src/lib/dancr/venue-public-visibility.ts';
const source=readFileSync(new URL('../src/lib/dancr/customer.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source+'\nexport {getFollowedVenues,getGoingShifts,getListedSavedVenueIds};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
vm.runInNewContext(compiled,{exports,Date,Set,Map,console,require(name){
  if(name==='./public')return {isApprovedPublicDancerRow:isPublicDancerProfileEligible,isShiftPubliclyVisible:()=>false};
  if(name==='./venue-public-visibility')return {isPublicVenueRow};
  if(name==='./responsive-image')return {responsivePublicImage:()=>null};
  if(name==='./shift-presence')return {isActiveNfcPresence:()=>false};
  if(name==='./venue-branding')return {verifiedVenueLogoUrl:()=>null};
  if(name==='./customer-venue-activity')return {getSavedVenueActivity:async()=>new Map()};
  assert.fail(name);
}});
const venue=id=>({id,name:'Synthetic public venue',slug:id,city:'Synthetic City',is_active:true});
const dancer={id:'dancer',slug:'dancer',stage_name:'Synthetic Dancer',status:'approved',verification_status:'approved',is_public:true,disabled_at:null,dancer_photos:[]};
const copy=value=>JSON.parse(JSON.stringify(value));
function client(resolve,{privateReads=false}={}) {
  const calls=[];return {calls,from(table){const call={table,methods:[]};calls.push(call);const q=new Proxy({},{get(_t,key){
    if(key==='then')return (ok,bad)=>Promise.resolve(resolve(call)).then(ok,bad);
    return (...args)=>{if(privateReads&&key==='select')assert.doesNotMatch(args[0],/has_active_club_deal|owner_user_id|page_review/);call.methods.push([key,...args]);return q;};
  }});return q;}};
}
for(const reader of ['getFollowedVenues','getGoingShifts'])test(`${reader} retains private ownership reads and resolves only the referenced public venue IDs`,async()=>{
  const row=reader==='getFollowedVenues'?{venue_id:'visible',venues:venue('visible')}:{shift_id:'shift',shifts:{id:'shift',dancer_profiles:dancer,venues:venue('visible')}};
  const request=client(()=>({data:[row],error:null}),{privateReads:true});
  const server=client(()=>({data:[{id:'visible'},{id:'unrelated'}],error:null}));
  const result=await exports[reader](request,'authenticated-customer',server);
  assert.equal(result.length,1);assert.equal(request.calls.length,1);
  assert.ok(request.calls[0].methods.some(([m,k,v])=>m==='eq'&&k==='customer_id'&&v==='authenticated-customer'));
  assert.deepEqual(copy(server.calls),[{table:'venues',methods:[['select','id'],['in','id',['visible']],['eq','is_active',true],['eq','has_active_club_deal',true],['limit',1]]}]);
  assert.equal(reader==='getFollowedVenues'?result[0].venue.id:result[0].shift.venue.id,'visible');
});
for(const reader of ['getFollowedVenues','getGoingShifts'])test(`${reader} hides retired or offerless venues without changing private records`,async()=>{
  const row=reader==='getFollowedVenues'?{venue_id:'hidden',venues:venue('hidden')}:{shift_id:'shift',shifts:{id:'shift',dancer_profiles:dancer,venues:venue('hidden')}};
  const request=client(()=>({data:[row],error:null}),{privateReads:true}),server=client(()=>({data:[],error:null}));
  assert.equal((await exports[reader](request,'authenticated-customer',server)).length,0);
  assert.ok(request.calls.every(call=>call.methods.every(([m])=>!['insert','update','delete','upsert'].includes(m))));
});
test('public venue hydration rejects unrelated response IDs and removes duplicate/missing IDs before querying',async()=>{
  const server=client(()=>({data:[{id:'known'},{id:'unrelated'}],error:null}));
  const result=await exports.getListedSavedVenueIds(server,['known','known',null,undefined,'']);
  assert.deepEqual(Array.from(result),['known']);assert.deepEqual(copy(server.calls[0].methods[1]),['in','id',['known']]);
});
test('public venue hydration uses bounded batches and makes no query for an empty reference list',async()=>{
  const server=client(call=>({data:call.methods.find(([m])=>m==='in')[2].map(id=>({id})),error:null}));
  assert.equal((await exports.getListedSavedVenueIds(server,[])).size,0);assert.equal(server.calls.length,0);
  const ids=Array.from({length:401},(_,i)=>'venue-'+i);assert.equal((await exports.getListedSavedVenueIds(server,ids)).size,401);
  assert.deepEqual(server.calls.map(call=>call.methods.find(([m])=>m==='limit')[1]),[200,200,1]);
});
for(const reader of ['getFollowedVenues','getGoingShifts'])test(`${reader} stops on private read failure before server hydration`,async()=>{
  const error={code:'42501'},request=client(()=>({data:null,error})),server=client(()=>assert.fail('No server query'));
  await assert.rejects(exports[reader](request,'customer',server),value=>value===error);assert.equal(server.calls.length,0);
});
test('failed computed-field hydration cannot reuse stale visibility from a private row',async()=>{
  const error={code:'PGRST202'},request=client(()=>({data:[{venue_id:'venue',venues:{...venue('venue'),has_active_club_deal:true}}],error:null})),server=client(()=>({data:null,error}));
  await assert.rejects(exports.getFollowedVenues(request,'customer',server),value=>value===error);
});
for(const profile of [{...dancer,is_public:false},{...dancer,status:'disabled'}])test(`going venue hydration cannot reveal a ${profile.is_public?'disabled':'private'} dancer`,async()=>{
  const request=client(()=>({data:[{shift_id:'shift',shifts:{id:'shift',dancer_profiles:profile,venues:venue('venue')}}],error:null})),server=client(()=>({data:[{id:'venue'}],error:null}));
  assert.equal((await exports.getGoingShifts(request,'customer',server)).length,0);
});
