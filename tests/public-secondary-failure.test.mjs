import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { jsx, jsxs } from 'react/jsx-runtime';

const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
function load(path, dependencies={}, globals={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,console:{warn(){},log(){}},Date,Map,Set,require:name=>dependencies[name]||{},...globals});
  return exports;
}
const profile={id:'dancer',slug:'synthetic',stage_name:'Synthetic',city:'Las Vegas',status:'approved',verification_status:'approved',is_public:true,disabled_at:null,social_links:[],shifts:[]};
const service=load('src/lib/dancr/public.ts',{
  './profile-approval':{isPublicDancerProfileEligible:row=>row?.is_public===true},
  './markets':{isAllMyDancrCities:()=>false},
  './responsive-image':{responsivePublicImage:()=>null},
  './profile-link-alias':{resolveDancerProfileAlias:async()=>null},
});
function client({failedMetric='',coreError=false,photoError=false,rpcError=false,missing=false}={}) {
  return {rpc:async()=>({data:[],error:rpcError?{code:'57014'}:null}),from(table){
    const query=new Proxy({}, {get:(_,key)=>key==='then' ? (resolve,reject)=>Promise.resolve(
      table==='dancer_profiles'?{data:missing?null:profile,error:coreError?{code:'42501'}:null}
      :table==='dancer_photos'?{data:[],error:photoError?{code:'08006'}:null}
      :{count:7,error:table===failedMetric?{code:'57014'}:null}).then(resolve,reject)
      :()=>query}); return query;
  }};
}
test('profile metric failures preserve identity, media and schedules and explicitly mark counts unavailable',async()=>{
  for(const table of ['follows','profile_views','going_signals']){
    const result=await service.getDancerProfile(client({failedMetric:table}),'synthetic');
    assert.equal(result.id,'dancer');assert.equal(result.metricsUnavailable,true);
    assert.deepEqual(Array.from(result.photos),[]);assert.deepEqual(Array.from(result.upcomingShifts),[]);
  }
  const healthy=await service.getDancerProfile(client(),'synthetic');
  assert.equal(healthy.followerCount,7);assert.equal(healthy.metricsUnavailable,undefined);
});
test('core visibility/photo failures still fail closed and deleted profiles remain missing',async()=>{
  await assert.rejects(service.getDancerProfile(client({coreError:true}),'synthetic'),e=>e.code==='42501');
  await assert.rejects(service.getDancerProfile(client({photoError:true}),'synthetic'),e=>e.code==='08006');
  assert.equal(await service.getDancerProfile(client({missing:true}),'synthetic'),null);
});
test('public venue metrics preserve the venue set when the aggregation service fails',async()=>{
  const result=await service.getPublicVenuePopularity(client({rpcError:true}),['one','two']);
  assert.equal(result.size,2);assert.equal(result.get('one').metricsUnavailable,true);
});
test('discovery metric failures preserve core dancer cards',async()=>{
  const c=client({rpcError:true});const original=c.from;
  c.from=table=>table==='dancer_profiles'?new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>resolve({data:[profile],error:null}):()=>c.from(table)}):original(table);
  const result=await service.getLiveDancerDiscovery(c,'Las Vegas');
  assert.equal(result.dancers.length,1);assert.equal(result.dancers[0].metricsUnavailable,true);
});

test('profile video outages render a recoverable partial page; primary lookup failures still propagate',async()=>{
  const mapped={id:'dancer',slug:'synthetic',stageName:'Synthetic',city:'Las Vegas',photos:[],socialLinks:[],upcomingShifts:[],followerCount:0,goingCount:0};
  let primaryError=false;
  const page=load('app/dancers/[slug]/page.tsx',{
    'react/jsx-runtime':{jsx,jsxs},
    '@/src/lib/dancr/public':{getDancerProfile:async()=>{if(primaryError)throw new Error('primary unavailable');return mapped;}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},
    '@/src/lib/dancr/tv':{getPublicMyDancrTvFeed:async()=>{throw new Error('video unavailable');}},
  });
  const tree=await page.default({params:Promise.resolve({slug:'synthetic'})});
  function texts(node){if(!node)return '';if(typeof node==='string')return node;if(Array.isArray(node))return node.map(texts).join(' ');return texts(node.props?.children);}
  assert.match(texts(tree),/Some profile details are temporarily unavailable/);
  primaryError=true;await assert.rejects(page.default({params:Promise.resolve({slug:'synthetic'})}),/primary unavailable/);
});

test('the shell displays unavailable counts without presenting them as zero',()=>{
  const shell=read('outputs/index.html');
  const start=shell.indexOf('function profileActivityMetricsMarkup('),end=shell.indexOf('function dancerProfileUberRideMarkup(',start);
  const context={followerNumber:()=>0,tonightInterestCount:()=>0,profileViewsToday:()=>0,selectedCity:()=> 'Las Vegas'};
  vm.createContext(context);vm.runInContext(shell.slice(start,end)+';this.render=profileActivityMetricsMarkup;',context);
  const html=context.render({metricsUnavailable:true});
  assert.equal((html.match(/>—<\/dd>/g)||[]).length,3);assert.doesNotMatch(html,/>0<\/dd>/);
});
