import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {publicTvCacheControl} from '../src/lib/dancr/public-cache-policy.ts';
import {tvWorkspace,workspaceFixture} from './helpers/tv-workspace-fixture.mjs';

function routeFixture({authError,queryError,rows=[]}={}){
 const calls=[],exports={};
 const query=new Proxy({then:resolve=>resolve({data:queryError?null:rows,error:queryError||null})},{
  get:(target,key)=>target[key]||((...args)=>{calls.push([key,...args]);return query;})
 });
 const dependencies={
  'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
  '@/src/lib/api':{apiError:(error,fallback)=>{const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
  '@/src/lib/dancr/tv':{MYDANCR_TV_FILTERS:new Set(['for-you','following','tonight','new']),getPublicMyDancrTvFeed:async(_admin,input)=>{calls.push(['feed',input]);return [];}},
  '@/src/lib/dancr/media-limits':{MAX_DANCER_PROFILE_VIDEOS:50},
  '@/src/lib/dancr/public-cache-policy':{publicTvCacheControl},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({from:table=>{calls.push(['from',table]);return query;}})},
  '@/src/lib/supabase/request':{getBearerToken:r=>r.headers.get('authorization')?.slice(7)||null,createRequestSupabaseContext:async()=>{calls.push(['auth']);if(authError)throw authError;return {user:{id:'verified-customer'}};}},
 };
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/public/tv/route.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,{exports,require:name=>{assert.ok(name in dependencies,name);return dependencies[name];},URL,Request,Response,Error});
 return {calls,GET:(filter='following',token='synthetic')=>exports.GET(new Request('https://mydancr.com/api/public/tv?filter='+filter,{headers:token?{authorization:'Bearer '+token}:{}}))};
}

for(const [name,options,status] of [
 ['expired credentials',{authError:new Error('Sign in required.')},401],
 ['unavailable session provider',{authError:new PublicApiError('UNAVAILABLE','Session verification is temporarily unavailable.',503)},503],
 ['query timeout',{queryError:{code:'57014',message:'private database details'}},503],
 ['connection loss',{queryError:{code:'08006',message:'private database details'}},503],
 ['authorization rejection',{queryError:{code:'42501',message:'private policy details'}},500],
 ['unexpected cardinality',{queryError:{code:'PGRST116',message:'private row details'}},500],
])test('Following does not turn '+name+' into a successful empty feed',async()=>{
 const f=routeFixture(options),response=await f.GET(),body=await response.json();
 assert.equal(response.status,status);assert.equal(body.ok,false);
 assert.equal(f.calls.some(c=>c[0]==='feed'),false);
 assert.doesNotMatch(JSON.stringify(body),/private (database|policy|row) details/);
});

test('Following with no credentials remains the sign-in state without authenticated queries',async()=>{
 const f=routeFixture(),response=await f.GET('following',''),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.requiresAccount,true);assert.deepEqual(body.videos,[]);
 assert.equal(f.calls.some(c=>c[0]==='auth'||c[0]==='from'),false);
 assert.match(response.headers.get('cache-control'),/private.*no-store/);
});
test('an authenticated empty Following result remains a successful empty feed',async()=>{
 const f=routeFixture(),response=await f.GET(),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.requiresAccount,false);assert.deepEqual(body.videos,[]);
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='customer_id'&&c[2]==='verified-customer'));
});
test('Following uses only rows selected for the verified account',async()=>{
 const f=routeFixture({rows:[{dancer_id:'first'},{dancer_id:'second'}]});
 assert.equal((await f.GET()).status,200);
 assert.deepEqual(Array.from(f.calls.find(c=>c[0]==='feed')[1].followingDancerIds),['first','second']);
 assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='customer_id'&&c[2]==='verified-customer'));
});
test('the public TV feed does not require an account or query follows',async()=>{
 const f=routeFixture({authError:new Error('Sign in required.')});
 assert.equal((await f.GET('for-you')).status,200);
 assert.equal(f.calls.some(c=>c[0]==='auth'||c[0]==='from'),false);
});

for(const entry of ['owner','admin'])test(entry+' video workspace reports batch signing errors',async()=>{
 const f=workspaceFixture(3,{storageError:true});
 await assert.rejects(entry==='owner'?tvWorkspace.getDancerMyDancrTvWorkspace(f.client,'owner'):tvWorkspace.getAdminMyDancrTvVideos(f.client),/Storage unavailable/);
 assert.equal(f.calls.length,1);
});
test('a missing signing response cannot mark every existing video unavailable',async()=>{
 const f=workspaceFixture(3);
 f.client.storage.from=()=>({createSignedUrls:async()=>({data:null,error:null})});
 await assert.rejects(tvWorkspace.getDancerMyDancrTvWorkspace(f.client,'owner'),/Unable to prepare MyDancr TV playback/);
});
test('a later signing batch failure does not report a partial library as fully loaded',async()=>{
 const f=workspaceFixture(201),original=f.client.storage.from,problem={status:503,message:'Storage unavailable'};
 let batches=0;
 f.client.storage.from=bucket=>({createSignedUrls:async(...args)=>++batches===2?{data:null,error:problem}:original(bucket).createSignedUrls(...args)});
 await assert.rejects(tvWorkspace.getDancerMyDancrTvWorkspace(f.client,'owner'),error=>error===problem);
 assert.equal(batches,2);
});
