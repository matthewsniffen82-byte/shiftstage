import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {readBoundedRequestBytes} from '../../src/lib/bounded-json-body.ts';
import {resolveApiError} from '../../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../../src/lib/security/safe-error-metadata.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const schema=JSON.parse(read('../fixtures/payout-account-current.json'));
const quote=value=>'"'+value.replaceAll('"','""')+'"';
export const dancerId='a0000000-0000-4000-8000-000000000001';
export const otherId='b0000000-0000-4000-8000-000000000002';
export const initialTime='2020-01-01T00:00:00.000Z';
export const account=(enabled=true,overrides={})=>({
  id:'acct_synthetic',object:'account',country:'US',default_currency:'usd',
  details_submitted:true,payouts_enabled:enabled,charges_enabled:enabled,
  requirements:{currently_due:[],disabled_reason:enabled?null:'requirements.past_due'},
  future_requirements:{currently_due:[]},metadata:{dancer_id:dancerId},...overrides,
});
export async function database(){
  const db=new PGlite();
  await db.exec("set timezone='UTC';create table public.dancer_profiles(id uuid primary key)");
  await db.exec('create table public.dancer_payout_accounts('+schema.columns.map(c=>quote(c.name)+' '+quote(c.type_schema)+'.'+quote(c.type)+(c.default?' default '+c.default:'')+(c.nullable==='NO'?' not null':'')).join(',')+')');
  for(const c of schema.constraints)await db.exec('alter table public.dancer_payout_accounts add constraint '+quote(c.name)+' '+c.definition);
  for(const t of schema.triggers){await db.exec(t.function_definition);await db.exec(t.definition);}
  return db;
}
export async function reset(db,{seed=true,reference='acct_synthetic',updatedAt=initialTime}={}){
  await db.exec('truncate public.dancer_profiles cascade');
  await db.query('insert into public.dancer_profiles(id) values($1),($2)',[dancerId,otherId]);
  if(seed)await db.query('insert into public.dancer_payout_accounts(dancer_id,stripe_account_id,provider_account_id,updated_at) values($1,$2,$2,$3)',[dancerId,reference,updatedAt]);
}
export const row=async(db,owner=dancerId)=>(await db.query('select *,updated_at::text as updated_at from public.dancer_payout_accounts where dancer_id=$1',[owner])).rows[0]||null;
export async function insertCurrent(db,{owner=dancerId,reference='acct_synthetic',eligible='restricted'}={}){
  await db.query("insert into public.dancer_payout_accounts(dancer_id,stripe_account_id,provider_account_id,payout_eligibility,verification_status) values($1,$2,$2,$3,$3)",[owner,reference,eligible]);
}
function module(path,dependencies,Clock=Date){
  const exports={};
  vm.runInNewContext(ts.transpileModule(read(path),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText,{
    exports,Buffer,Date:Clock,Headers,process:{env:{}},console:{warn(){},error(){}},
    require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error('Unexpected dependency '+name);},
  });
  return exports;
}
export function harness(db,options={}){
  const calls=[],finished=[];
  let claimed=false;
  const allowed=new Set(schema.columns.map(c=>c.name));
  const client={from(table){
    assert.equal(table,'dancer_payout_accounts');
    const filters=[];
    let mutation=null,payload,settings={},selected='*';
    const q={
      select(value){selected=value;return q;},
      eq(key,value){assert.ok(allowed.has(key));filters.push([key,value]);return q;},
      is(key,value){assert.ok(allowed.has(key));assert.equal(value,null);filters.push([key,null]);return q;},
      upsert(value,config){mutation='upsert';payload=value;settings=config;return q;},
      update(value){mutation='update';payload=value;return q;},
      maybeSingle(){return execute();},single(){return execute();},
    };
    async function execute(){
      const kind=mutation||'read';
      calls.push({kind,filters,payload,settings});
      if(!mutation&&options.readError)return {data:null,error:options.readError};
      if(mutation&&options.writeError)return {data:null,error:options.writeError};
      if(mutation)await options.beforeWrite?.(kind);
      const values=[],bind=value=>{values.push(value&&typeof value==='object'?JSON.stringify(value):value);return '$'+values.length;};
      const projection=selected==='*'?'*,updated_at::text as updated_at':selected.split(',').map(value=>{value=value.trim();assert.ok(allowed.has(value));return quote(value);}).join(',');
      const where=()=>filters.map(([key,value])=>quote(key)+(value===null?' is null':'='+bind(value))).join(' and ');
      let sql;
      if(mutation==='update'){
        const set=Object.entries(payload).map(([key,value])=>{assert.ok(allowed.has(key));return quote(key)+'='+bind(value);});
        sql='update public.dancer_payout_accounts set '+set.join(',')+' where '+where()+' returning '+projection;
      }else if(mutation==='upsert'){
        const entries=Object.entries(payload);
        for(const [key] of entries)assert.ok(allowed.has(key));
        assert.equal(settings.onConflict,'dancer_id,payment_provider');
        sql='insert into public.dancer_payout_accounts('+entries.map(([key])=>quote(key)).join(',')+') values('+entries.map(([,value])=>bind(value)).join(',')+') on conflict(dancer_id,payment_provider) '+
          (settings.ignoreDuplicates?'do nothing':'do update set '+entries.map(([key])=>quote(key)+'=excluded.'+quote(key)).join(','))+' returning '+projection;
      }else sql='select '+projection+' from public.dancer_payout_accounts where '+where();
      try{
        const {rows}=await db.query(sql,values);assert.ok(rows.length<=1);
        if(mutation&&options.afterCommitError)return {data:null,error:options.afterCommitError};
        if(mutation&&options.missingAck)return {data:null,error:null};
        return {data:rows[0]||null,error:null};
      }catch(error){return {data:null,error};}
    }
    return q;
  }};
  const stripe={
    accounts:{
      retrieve:async(id,params,config)=>{
        calls.push({kind:'provider-read',id});
        if(claimed){assert.deepEqual(Object.keys(params),[]);assert.equal(config.timeout,10000);assert.equal(config.maxNetworkRetries,0);}
        if(options.retrieveError)throw options.retrieveError;
        return options.retrieve?options.retrieve(id):options.current||account();
      },
      create:async(payload,config)=>{
        calls.push({kind:'provider-create'});
        assert.equal(payload.metadata.dancer_id,dancerId);
        assert.equal(config.idempotencyKey,'mydancr-dancer-connect-'+dancerId);
        return options.create?options.create():account(false);
      },
    },
    accountLinks:{create:async payload=>{
      calls.push({kind:'provider-link',id:payload.account});
      return {url:'https://connect.example.test/synthetic',expires_at:2000000000};
    }},
  };
  const provider=module('../../src/lib/dancr/payout-provider.ts',{'server-only':{},'../stripe':{getStripe:()=>stripe}});
  const store=module('../../src/lib/dancr/payout-account-store.ts',{'./payout-provider':provider},options.Clock||Date);
  const events=module('../../src/lib/dancr/finance-provider-events.ts',{
    '../stripe':{getStripe:()=>stripe},'./finance-audit-log':{},'./payout-account-store':store,'./payout-provider':provider,
  });
  const actions=module('../../src/lib/dancr/dancer-payout-actions.ts',{
    './finance-reporting':{},'./payout-provider':provider,'./nats':{getNatsRuntimeConfig:()=>({selected:options.nats===true})},
    './payout-account-store':{
      ...store,getDancerForUser:async(_client,userId)=>{assert.equal(userId,'synthetic-owner');return {id:dancerId,email:'synthetic@example.test'};},
      getEffectivePayoutSettings:async()=>({payoutsEnabled:options.enabled!==false,paymentProvider:'stripe'}),
    },
  });
  const route=module('../../app/api/stripe/webhook/route.ts',{
    'next/server':{NextResponse:{json:Response.json}},
    '@/src/lib/api':{apiError:(error,fallback)=>{const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
    '@/src/lib/bounded-json-body':{readBoundedRequestBytes},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/dancr/payments':{},'@/src/lib/dancr/finance-provider-events':{
      ...events,recordPaymentProviderWebhook:async()=>{claimed=true;return true;},
      finishPaymentProviderWebhook:async(...args)=>finished.push(args[3]?'failed':'processed'),
    },
    '@/src/lib/server-env':{getServerEnv:()=>'synthetic-account-webhook-secret'},
    '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},stripe:Stripe,
  });
  async function deliver(snapshot=account()){
    const secret='synthetic-account-webhook-secret';
    const payload=JSON.stringify({id:'evt_account_synthetic',type:'account.updated',created:1700000000,data:{object:snapshot}});
    const signature=Stripe.webhooks.generateTestHeaderString({payload,secret});
    return route.POST(new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload}));
  }
  return {
    deliver,calls,finished,client,store,provider,
    refresh:()=>actions.refreshDancerConnectAccount(client,'synthetic-owner'),
    onboard:()=>actions.createDancerConnectOnboarding(client,'synthetic-owner','https://example.test/return','https://example.test/refresh'),
  };
}
