import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash,createHmac,randomUUID} from 'node:crypto';

export const id=n=>'92000000-0000-4000-8000-'+String(n).padStart(12,'0');
export class PublicApiError extends Error {constructor(code,message,status){super(message);this.code=code;this.status=status;}}
export class PublicRequestRateLimitError extends Error {retryAfterSeconds=60;}
export function compile(file,deps={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Date,Map,Set,URL,Request,Response,TextDecoder,Uint8Array,setTimeout,clearTimeout,performance,process:{env:{}},
   require:name=>{assert.ok(name in deps,'unmocked dependency '+name);return deps[name];}});
 return exports;
}
export const ranking=compile('src/lib/dancr/discovery-ranking.ts');
export const row=(n,extra={})=>({id:id(n),dancerId:id(n),city:'Vegas',venueId:null,availableUntil:null,nextShiftAt:null,nextShiftEndsAt:null,freshAt:null,duration:20,
 buckets:Array.from({length:3},()=>({impressions:0,actions:0,engaged:0,completed:0})),...extra});
export function fixture(candidates=[row(1),row(2)]) {
 const data={discovery_sessions:[],discovery_events:[],follows:[],venue_follows:[],dancer_profiles:[],mydancr_tv_videos:[]},calls=[];
 let blocked=false;
 const admin={auth:{getUser:async token=>({data:{user:token==='valid'?{id:id(99)}:null},error:token==='valid'?null:new Error('expired')})},
  rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='get_discovery_candidates'?structuredClone(candidates.filter(row=>!args.p_dancer_ids || args.p_dancer_ids.includes(row.dancerId))):null,error:null};},
  from(table) {
   const filters=[];let mutation=null,payload=null,options=null,single=false,limit=Infinity,order=null;
   const execute=()=>{
    const all=data[table] || [];
    let rows=all.filter(row=>filters.every(fn=>fn(row)));
    if(mutation==='delete'){data[table]=all.filter(row=>!rows.includes(row));return {data:null,error:null};}
    if(mutation==='upsert'){
     const keys=options.onConflict.split(',');
     const found=all.find(row=>keys.every(key=>row[key]===payload[key]));
     if(!found)all.push({id:randomUUID(),occurred_at:new Date().toISOString(),...structuredClone(payload)});
     return {data:null,error:null};
    }
    if(order)rows.sort((a,b)=>String(a[order[0]]).localeCompare(String(b[order[0]]))*(order[1]?.ascending===false?-1:1));
    rows=rows.slice(0,limit);return {data:structuredClone(single?rows[0]||null:rows),error:null};
   };
   const query={select(){return query;},eq(k,v){filters.push(row=>row[k]===v);return query;},in(k,v){filters.push(row=>v.includes(row[k]));return query;},
    gt(k,v){filters.push(row=>row[k]>v);return query;},gte(k,v){filters.push(row=>row[k]>=v);return query;},lte(k,v){filters.push(row=>row[k]<=v);return query;},
    limit(n){limit=n;return query;},order(...args){order=args;return query;},maybeSingle(){single=true;return query;},single(){single=true;return query;},
    delete(){mutation='delete';return query;},upsert(value,opts){mutation='upsert';payload=value;options=opts;return query;},
    then(resolve,reject){return Promise.resolve().then(execute).then(resolve,reject);}};
   return query;
  }};
 const limiter={PublicRequestRateLimitError,enforcePublicRequestRateLimit:async()=>{if(blocked)throw new PublicRequestRateLimitError();}};
 const service=compile('src/lib/dancr/discovery-service.ts',{'server-only':{},'node:crypto':{createHash,createHmac},
  '../server-env':{getServerEnv:()=> 'synthetic-test-secret'},'../supabase/request':{getBearerToken:req=>req.headers.get('authorization')?.replace('Bearer ','')||null},
  '../api-error-policy':{PublicApiError},'./discovery-ranking':ranking,'./markets':{isAllMyDancrCities:city=>city==='All cities'},'./public-request-rate-limit':limiter});
 const request=(viewer=id(50),visit=id(51),token='')=>new Request('https://example.test',{headers:{'x-discovery-session':viewer,'x-discovery-visit':visit,...(token?{authorization:'Bearer '+token}:{})}});
 return {admin,data,calls,service,limiter,request,block:()=>{blocked=true;}};
}
