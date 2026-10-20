import assert from 'node:assert/strict';
import test from 'node:test';
import {compile} from './helpers/discovery-fixture.mjs';

function routeFixture({denied=false,eligible=true,failed=false}={}) {
  const calls=[];
  const admin={from(table){const filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},async single(){
    calls.push({table,filters});
    return {data:table==='dancer_profiles'?{id:'mine',city:'Vegas'}:{name:'Club A'},error:null};
  }};return q;},async rpc(name,args){calls.push({name,args});return {data:eligible?[{dancerId:'other',venueId:'secret-club'},{dancerId:'mine',venueId:'club-a'}]:[],error:failed?new Error("Unavailable"):null};}};
  const route=compile('app/api/dancer/discovery/route.ts',{
    'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:error=>Response.json({ok:false,error:error.message},{status:denied?401:503})},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(_request,access)=>{assert.equal(access.role,'dancer');if(denied)throw new Error('No access');return {user:{id:'owner'}};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/src/lib/dancr/discovery-service':{readRankingCandidates:rows=>rows},
  });
  return {calls,route};
}

test('dancer discovery exposes visibility only, never scores or weights, even with injected IDs',async()=>{
  for(const eligible of [true,false]) {
    const {calls,route}=routeFixture({eligible});
    const response=await route.GET(new Request('https://mydancr.test/api/dancer/discovery?dancerId=other&venueId=secret-club'));
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(calls[0],{table:'dancer_profiles',filters:[['user_id','owner']]});
    const data=await response.json();assert.deepEqual(data,{ok:true,eligible});
    assert.doesNotMatch(JSON.stringify(data),/other|secret-club|user_id/);
  }
});

test('denied and failed visibility reads cannot expose ranking data',async()=>{
  const denied=routeFixture({denied:true});assert.equal((await denied.route.GET(new Request('https://mydancr.test/api/dancer/discovery'))).status,401);
  assert.equal(denied.calls.length,0);
  const failed=routeFixture({failed:true});const response=await failed.route.GET(new Request('https://mydancr.test/api/dancer/discovery'));
  assert.equal(response.status,503);assert.equal((await response.json()).score,undefined);
});
