import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import test, {before, beforeEach, after} from 'node:test';
import ts from 'typescript';
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {readBoundedRequestBytes} from '../src/lib/bounded-json-body.ts';
import {resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';

const read = path => path==='../src/lib/dancr/finance-provider-events.ts'&&process.env.MYDANCR_PAID_RECOVERY_CALLER_BASELINE==='1'
  ? execFileSync('git',['show','f61aa2bbbede15453af95fb360e54bbd0d636057:src/lib/dancr/finance-provider-events.ts'],{encoding:'utf8',windowsHide:true})
  : readFileSync(new URL(path, import.meta.url), 'utf8');
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const transferId = 'tr_reversal_synthetic';
const secret = 'synthetic-reversal-test-secret';
const initialTime = '2020-01-01T00:00:00.000Z';
let pg;

before(async () => {
  pg = new PGlite();
  await pg.exec([
    'create role anon; create role authenticated; create role service_role bypassrls;',
    "create table public.dancer_payout_batches(id uuid primary key, dancer_id uuid not null, currency text not null default 'usd', amount_cents integer not null default 1000, status text not null, payment_provider text not null default 'stripe', provider_reference_id text unique, external_reference text, paid_at timestamptz, failed_at timestamptz, canceled_at timestamptz, failure_message text, updated_at timestamptz not null);",
    "create table public.commission_events(id uuid primary key, dancer_id uuid not null, currency text not null default 'usd', amount_cents integer not null default 1000, payout_batch_id uuid, status text not null, paid_at timestamptz, payment_provider text, metadata jsonb not null default '{}', recovery_required boolean not null default false, review_flag text);",
    'create table public.dancer_payout_items(id uuid primary key default gen_random_uuid(), payout_batch_id uuid not null, commission_event_id uuid not null, amount_cents integer not null);',
    'create table public.financial_audit_events(id bigint generated always as identity primary key, actor_type text, action text, target_type text, target_id text, after_state jsonb, reason text, metadata jsonb);',
    'alter table public.dancer_payout_batches enable row level security;',
    'alter table public.commission_events enable row level security;',
    'alter table public.financial_audit_events enable row level security;',
    'alter table public.dancer_payout_items enable row level security;',
    'grant all on public.dancer_payout_batches, public.dancer_payout_items, public.commission_events, public.financial_audit_events to service_role; grant all on all sequences in schema public to service_role;',
  ].join('\n'));
  for (const [file, signature] of [
    ['stripe-payout-release.sql', 'release_dancer_payout_batch(uuid,text,text)'],
    ['stripe-payout-completion.sql', 'complete_dancer_payout_batch(uuid,text,timestamptz)'],
  ]) {
    await pg.exec(read('./fixtures/' + file).replace(/\r\n/g, '\n'));
    await pg.exec('revoke all on function public.' + signature + ' from public,anon,authenticated; grant execute on function public.' + signature + ' to service_role;');
  }
  // This signed-webhook harness uses explicit table projections. Full captured
  // financial schema/trigger coverage is in paid-payout-recovery-postgres.test.mjs.
  await pg.exec(read('../supabase/migrations/20260910160000_add_atomic_paid_payout_recovery.sql').replace(/\r\n/g,'\n'));
});
after(async () => pg?.close());
beforeEach(async () => {
  await pg.exec('reset role; drop trigger if exists synthetic_audit_failure on financial_audit_events; truncate public.dancer_payout_batches, public.dancer_payout_items, public.commission_events, public.financial_audit_events restart identity; set role service_role');
  for (const [key, ref] of [[id, transferId], [otherId, 'tr_unrelated']]) {
    await pg.query("insert into public.dancer_payout_batches(id,dancer_id,status,provider_reference_id,updated_at) values($1,$1,'processing',$2,$3)", [key,ref,initialTime]);
    await pg.query("insert into public.commission_events(id,dancer_id,payout_batch_id,status,payment_provider,metadata) values($1,$1,$1,'payout_processing','stripe','{\"existing\":true}')", [key]);
    await pg.query('insert into public.dancer_payout_items(payout_batch_id,commission_event_id,amount_cents) values($1,$1,1000)',[key]);
  }
});
async function release(payoutId = id, status = 'failed') {
  return (await pg.query('select public.release_dancer_payout_batch($1,$2,$3) result', [payoutId,status,'Synthetic reversal'])).rows[0].result;
}
async function complete(payoutId = id, reference = transferId) {
  return (await pg.query('select public.complete_dancer_payout_batch($1,$2,$3) result', [payoutId,reference,initialTime])).rows[0].result;
}
async function recover(args={p_payout_id:id,p_provider_reference_id:transferId,p_reason:'Synthetic reversal'}) {
  return (await pg.query('select public.flag_paid_payout_recovery_safely($1,$2,$3) result',[args.p_payout_id,args.p_provider_reference_id,args.p_reason])).rows[0].result;
}
const state = async () => ({
  payouts:(await pg.query('select * from public.dancer_payout_batches order by id')).rows,
  earnings:(await pg.query('select * from public.commission_events order by id')).rows,
  audits:(await pg.query('select * from public.financial_audit_events order by target_id,action')).rows,
});
function module(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText, {
    exports,Buffer,Date,Headers,console:{warn(){},error(){}},
    require:name => {
      if (Object.hasOwn(dependencies,name)) return dependencies[name];
      throw new Error('Unexpected dependency ' + name);
    },
  });
  return exports;
}
function harness({rpc, beforeRpc, completion, beforeCompletion, recovery, beforeRecovery, readErrorAt=0, beforeRead, recoveryError=false, auditError=false} = {}) {
  const calls=[], finished=[];
  let reads=0, sequence=0;
  const allowed = {
    dancer_payout_batches:new Set(['id','status','provider_reference_id','payment_provider']),
    commission_events:new Set(['payout_batch_id','status','recovery_required','review_flag']),
    financial_audit_events:new Set(['actor_type','action','target_type','target_id','reason','metadata']),
  };
  const client = {
    async rpc(name,args) {
      if (name==='flag_paid_payout_recovery_safely') {
        calls.push({kind:'recovery',args});await beforeRecovery?.();
        if(recoveryError)return {data:null,error:{code:'08006',message:'Synthetic private recovery failure'}};
        if(recovery)return recovery(args);
        if(auditError)await pg.exec("reset role;create or replace function public.synthetic_audit_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic private audit failure';end$$;create trigger synthetic_audit_failure before insert on financial_audit_events for each row execute function public.synthetic_audit_failure();set role service_role");
        try{return {data:await recover(args),error:null};}catch(error){return {data:null,error};}
        finally{if(auditError)await pg.exec('reset role;drop trigger synthetic_audit_failure on financial_audit_events;set role service_role');}
      }
      if (name==='complete_dancer_payout_batch') {
        calls.push({kind:'complete',args});
        await beforeCompletion?.();
        if (completion) return completion(args);
        try {return {data:(await pg.query('select public.complete_dancer_payout_batch($1,$2,$3) result',[args.p_batch_id,args.p_transfer_id,args.p_paid_at])).rows[0].result,error:null};}
        catch (error) {return {data:null,error};}
      }
      assert.equal(name,'release_dancer_payout_batch');
      calls.push({kind:'release',args});
      await beforeRpc?.();
      if (rpc) return rpc(args);
      try {
        return {data:(await pg.query('select public.release_dancer_payout_batch($1,$2,$3) result', [args.p_batch_id,args.p_status,args.p_failure_message])).rows[0].result,error:null};
      } catch (error) { return {data:null,error}; }
    },
    from(table) {
      assert.ok(Object.hasOwn(allowed,table));
      const filters=[];
      let selection, update, insert;
      const q = {
        select(value) {selection=value; return q;},
        eq(key,value) {assert.ok(allowed[table].has(key)); filters.push([key,value]); return q;},
        update(value) {update=value; return q;},
        insert(value) {insert=value; return q;},
        maybeSingle:execute,
        then(resolve,reject) {return execute().then(resolve,reject);},
      };
      async function execute() {
        if (update || insert) {
          const values=Object.entries(update || insert);
          for (const [key] of values) assert.ok(allowed[table].has(key));
          calls.push({kind:table,filters,values});
          if ((update && recoveryError) || (insert && auditError)) return {data:null,error:{code:'08006',message:'Synthetic private write error'}};
          const args=values.map(([,value]) => value);
          const sql=insert ? 'insert into public.'+table+'('+values.map(([key])=>key).join(',')+') values('+args.map((_,i)=>'$'+(i+1)).join(',')+')'
            : 'update public.'+table+' set '+values.map(([key],i)=>key+'=$'+(i+1)).join(',')+' where '+filters.map(([key],i)=>key+'=$'+(args.length+i+1)).join(' and ');
          if (update) args.push(...filters.map(([,value])=>value));
          await pg.query(sql,args);
          return {data:null,error:null};
        }
        reads++;
        calls.push({kind:'read',filters,selection});
        await beforeRead?.(reads);
        if (reads===readErrorAt) return {data:null,error:{code:'08006',message:'Synthetic private read detail'}};
        const columns=selection.split(',').map(key=>{key=key.trim(); assert.ok(allowed[table].has(key)); return key;}).join(',');
        const sql='select '+columns+' from public.'+table+' where '+filters.map(([key],i)=>key+'=$'+(i+1)).join(' and ');
        const {rows}=await pg.query(sql,filters.map(([,value])=>value));
        assert.ok(rows.length<=1);
        return {data:rows[0]||null,error:null};
      }
      return q;
    },
  };
  const audit=module('../src/lib/dancr/finance-audit-log.ts',{});
  const events=module('../src/lib/dancr/finance-provider-events.ts', {
    './finance-audit-log':audit,'./payout-account-store':{},'./payout-provider':{},'../stripe':{},
  });
  const route=module('../app/api/stripe/webhook/route.ts', {
    'next/server':{NextResponse:{json:Response.json}},
    '@/src/lib/api':{apiError:(error,fallback)=>{const result=resolveApiError(error,fallback); return Response.json(result.body,{status:result.status});}},
    '@/src/lib/bounded-json-body':{readBoundedRequestBytes},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/dancr/payments':{},
    '@/src/lib/dancr/finance-provider-events':{
      ...events,recordPaymentProviderWebhook:async()=>true,
      finishPaymentProviderWebhook:async(...args)=>finished.push(args[2]?'failed':'processed'),
    },
    '@/src/lib/server-env':{getServerEnv:()=>secret},
    '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},stripe:Stripe,
  });
  async function deliver(reference=transferId, transfer={}) {
    const payload=JSON.stringify({id:'evt_reversal_synthetic_'+(++sequence),type:'transfer.reversed',created:1700000000,data:{object:{id:reference,object:'transfer',created:1700000000,amount:1000,amount_reversed:1000,reversed:true,...transfer}}});
    const signature=Stripe.webhooks.generateTestHeaderString({payload,secret});
    return route.POST(new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload}));
  }
  return {deliver,calls,finished,events,client};
}
async function failed(response,h) {
  assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{ok:false,error:'Unable to process Stripe webhook.'});
  assert.deepEqual(h.finished,['failed']);
  assert.ok(h.calls.filter(c=>c.kind==='release').length<=1,'Never repeat a financial write in one delivery');
}

for (const status of ['requested','processing']) {
  test(status+' reversal releases only its reservation and retains the audit and metadata',async()=>{
    await pg.query('update public.dancer_payout_batches set status=$1 where id=$2',[status,id]);
    const h=harness();
    assert.equal((await h.deliver()).status,200);
    const s=await state();
    assert.deepEqual(s.payouts.map(x=>x.status),['failed','processing']);
    assert.deepEqual(s.earnings.map(x=>x.status),['available','payout_processing']);
    assert.equal(s.earnings[0].payout_batch_id,null);
    assert.equal(s.earnings[0].payment_provider,null);
    assert.equal(s.earnings[0].metadata.existing,true);
    assert.equal(s.earnings[0].metadata.released_payout_id,id);
    assert.equal(s.audits.length,1);
    assert.equal(s.audits[0].action,'release_payout_reservation');
    assert.equal(h.calls.filter(c=>c.kind==='release').length,1);
    assert.deepEqual(h.finished,['processed']);
  });
}
for (const status of ['failed','canceled']) {
  test('another signed reversal for the same '+status+' transfer preserves all prior state',async()=>{
    await release(id,status);
    const prior=await state(),h=harness();
    assert.equal((await h.deliver()).status,200);
    assert.equal((await h.deliver()).status,200);
    assert.deepEqual(await state(),prior);
    assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
    assert.deepEqual(h.finished,['processed','processed']);
  });
}
test('unknown reference is a no-op even when a released payout exists',async()=>{
  await release();
  const prior=await state(),h=harness();
  assert.equal((await h.deliver('tr_unknown')).status,200);
  assert.deepEqual(await state(),prior);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});

async function pendingReference() {
  await pg.query('update public.dancer_payout_batches set provider_reference_id=$1 where id=$2',['mydancr-payout-'+id,id]);
}

for (const amountReversed of [250,1000]) {
  test('early '+amountReversed+' reversal retries until the dispatch reference is saved',async()=>{
    await pendingReference();
    const prior=await state(),h=harness();
    const transfer={amount_reversed:amountReversed,metadata:{payout_batch_id:id}};
    await failed(await h.deliver(transferId,transfer),h);
    assert.deepEqual(await state(),prior,'An early callback must retain all reservations and financial history');
    assert.ok(h.calls.every(c=>c.kind==='read'),'Metadata alone never authorizes a financial write');
    await pg.query('update public.dancer_payout_batches set provider_reference_id=$1 where id=$2',[transferId,id]);
    assert.equal((await h.deliver(transferId,transfer)).status,200);
    assert.deepEqual(h.finished,['failed','processed']);
    const s=await state();
    assert.equal(s.payouts[0].status,amountReversed===1000?'failed':'paid');
    assert.equal(s.earnings[0].status,amountReversed===1000?'available':'paid');
    assert.equal(s.earnings[0].recovery_required,amountReversed!==1000);
    assert.deepEqual(s.payouts[1],prior.payouts[1]);
    assert.deepEqual(s.earnings[1],prior.earnings[1]);
  });

  test('reference saved between the two reads retains '+amountReversed+' reversal handling',async()=>{
    await pendingReference();
    const h=harness({beforeRead:async count=>{
      if(count===2) await pg.query('update public.dancer_payout_batches set provider_reference_id=$1 where id=$2',[transferId,id]);
    }});
    assert.equal((await h.deliver(transferId,{amount_reversed:amountReversed,metadata:{payout_batch_id:id}})).status,200);
    const s=await state();
    assert.equal(s.payouts[0].status,amountReversed===1000?'failed':'paid');
    assert.equal(s.earnings[0].status,amountReversed===1000?'available':'paid');
    assert.equal(s.earnings[0].recovery_required,amountReversed!==1000);
    assert.deepEqual(h.finished,['processed']);
  });
}

test('completion between reference lookups preserves paid manual recovery',async()=>{
  await pendingReference();
  const h=harness({beforeRead:async count=>{if(count===2) await complete();}});
  assert.equal((await h.deliver(transferId,{metadata:{payout_batch_id:id}})).status,200);
  const s=await state();
  assert.equal(s.payouts[0].status,'paid');
  assert.equal(s.earnings[0].status,'paid');
  assert.equal(s.earnings[0].recovery_required,true);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});

test('uncertain pending-reference lookup fails safely without acknowledging the reversal',async()=>{
  await pendingReference();
  const prior=await state(),h=harness({readErrorAt:2});
  await failed(await h.deliver(transferId,{metadata:{payout_batch_id:id}}),h);
  assert.deepEqual(await state(),prior);
});

for (const status of ['requested','paid','failed','canceled']) {
  test('metadata does not claim a '+status+' payout with an unmatched reference',async()=>{
    await pendingReference();
    await pg.query('update public.dancer_payout_batches set status=$1 where id=$2',[status,id]);
    const prior=await state(),h=harness();
    assert.equal((await h.deliver(transferId,{metadata:{payout_batch_id:id}})).status,200);
    assert.deepEqual(await state(),prior);
    assert.ok(h.calls.every(c=>c.kind==='read'));
  });
}

for (const provider of ['adyen','other']) {
  test('metadata cannot attach a Stripe reversal to a '+provider+' payout',async()=>{
    await pendingReference();
    await pg.query('update public.dancer_payout_batches set payment_provider=$1 where id=$2',[provider,id]);
    const prior=await state(),h=harness();
    assert.equal((await h.deliver(transferId,{metadata:{payout_batch_id:id}})).status,200);
    assert.deepEqual(await state(),prior);
    assert.ok(h.calls.every(c=>c.kind==='read'));
  });
}

for (const reference of [null,'tr_different','mydancr-payout-'+otherId]) {
  test('metadata alone cannot replace unmatched reference '+String(reference),async()=>{
    await pg.query('update public.dancer_payout_batches set provider_reference_id=$1 where id=$2',[reference,id]);
    const prior=await state(),h=harness();
    assert.equal((await h.deliver(transferId,{metadata:{payout_batch_id:id}})).status,200);
    assert.deepEqual(await state(),prior);
    assert.ok(h.calls.every(c=>c.kind==='read'));
  });
}

for (const batchId of [undefined,'','not-a-uuid','id.eq.'+id,id+',id.eq.'+otherId,{},'00000000-0000-4000-8000-000000000099']) {
  test('unrelated or malformed metadata remains a no-op: '+JSON.stringify(batchId),async()=>{
    await pendingReference();
    const prior=await state(),h=harness();
    assert.equal((await h.deliver(transferId,{metadata:{payout_batch_id:batchId}})).status,200);
    assert.deepEqual(await state(),prior);
    assert.ok(h.calls.every(c=>c.kind==='read'));
    if(batchId!=='00000000-0000-4000-8000-000000000099') assert.equal(h.calls.length,1,'Invalid identifiers never reach the fallback query');
  });
}
test('paid reversal keeps paid earnings and flags manual recovery without an automatic debit',async()=>{
  await complete();
  const h=harness();
  assert.equal((await h.deliver()).status,200);
  const s=await state();
  assert.deepEqual(s.payouts.map(x=>x.status),['paid','processing']);
  assert.deepEqual(s.earnings.map(x=>x.status),['paid','payout_processing']);
  assert.equal(s.earnings[0].recovery_required,true);
  assert.equal(s.earnings[0].review_flag,'paid_payout_reversed_by_provider');
  assert.equal(s.earnings[1].recovery_required,false);
  assert.equal(s.audits.length,2);
  assert.equal(s.audits.find(x=>x.action==='paid_payout_recovery_required').metadata.automatic_debit_attempted,false);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
for (const error of ['recoveryError','auditError']) {
  test('paid reversal retains failure when '+error+' prevents its existing recovery record',async()=>{
    await complete();
    const h=harness({[error]:true});
    await failed(await h.deliver(),h);
    assert.equal((await state()).earnings[0].status,'paid');
  });
}
const uncertain=[
  ['error',{data:null,error:{code:'08006',message:'Synthetic private detail'}}],
  ['empty',{data:null,error:null}],
  ['missing status',{data:{id},error:null}],
  ['different ID',{data:{id:otherId,status:'failed'},error:null}],
  ['wrong status',{data:{id,status:'paid'},error:null}],
];
for (const [label,result] of uncertain) {
  test('committed release with '+label+' is acknowledged only after an exact stored result',async()=>{
    const h=harness({rpc:async()=>{await release(); return result;}});
    assert.equal((await h.deliver()).status,200);
    assert.equal((await state()).audits.length,1);
    assert.equal(h.calls.filter(c=>c.kind==='release').length,1);
    assert.equal(h.calls.filter(c=>c.kind==='read').length,2);
    assert.deepEqual(h.calls.filter(c=>c.kind==='read')[1].filters,[['id',id],['provider_reference_id',transferId]]);
    assert.deepEqual(h.finished,['processed']);
  });
  test('uncommitted release with '+label+' cannot report successful delivery',async()=>{
    const prior=await state(),h=harness({rpc:async()=>result});
    await failed(await h.deliver(),h);
    assert.deepEqual(await state(),prior);
  });
}
test('a competing release is confirmed without a second release operation',async()=>{
  const h=harness({beforeRpc:async()=>release()});
  assert.equal((await h.deliver()).status,200);
  assert.equal((await state()).audits.length,1);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,1);
});
test('a competing cancellation is confirmed as the stored terminal outcome',async()=>{
  const h=harness({beforeRpc:async()=>release(id,'canceled')});
  assert.equal((await h.deliver()).status,200);
  assert.equal((await state()).payouts[0].status,'canceled');
  assert.equal((await state()).audits.length,1);
});
test('a competing payment remains paid and is flagged for recovery on explicit redelivery',async()=>{
  const h=harness({beforeRpc:async()=>complete()});
  await failed(await h.deliver(),h);
  assert.equal((await state()).earnings[0].status,'paid');
  const retry=harness();
  assert.equal((await retry.deliver()).status,200);
  assert.equal((await state()).earnings[0].recovery_required,true);
  assert.equal(retry.calls.filter(c=>c.kind==='release').length,0);
});
test('another payout being released cannot confirm this unfinished payout',async()=>{
  const h=harness({rpc:async()=>({data:await release(otherId),error:null})});
  await failed(await h.deliver(),h);
  assert.equal((await state()).payouts[0].status,'processing');
  assert.equal((await state()).payouts[1].status,'failed');
});
test('a different stored reference cannot confirm the uncertain release',async()=>{
  const h=harness({rpc:async()=>{await release(); await pg.query('update public.dancer_payout_batches set provider_reference_id=$1 where id=$2',['tr_replaced',id]); return {data:null,error:null};}});
  await failed(await h.deliver(),h);
});
for (const readErrorAt of [1,2]) {
  test('database read failure '+readErrorAt+' prevents an unconfirmed acknowledgment',async()=>{
    const h=harness({readErrorAt,rpc:async()=>{await release(); return {data:null,error:null};}});
    await failed(await h.deliver(),h);
    assert.equal(h.calls.filter(c=>c.kind==='release').length,readErrorAt===1?0:1);
  });
}
test('missing payout after an uncertain response cannot acknowledge success',async()=>{
  const h=harness({rpc:async()=>{await pg.query('delete from public.dancer_payout_batches where id=$1',[id]); return {data:null,error:null};}});
  await failed(await h.deliver(),h);
});
test('thrown transport failure after commit is recoverable by a later signed delivery',async()=>{
  const h=harness({rpc:async()=>{await release(); throw new Error('Synthetic private transport detail');}});
  await failed(await h.deliver(),h);
  const prior=await state(),retry=harness();
  assert.equal((await retry.deliver()).status,200);
  assert.deepEqual(await state(),prior);
  assert.equal(retry.calls.filter(c=>c.kind==='release').length,0);
});
for (const role of ['anon','authenticated']) {
  test(role+' cannot execute the captured privileged release function',async()=>{
    await pg.exec('reset role; set role '+role);
    try {await assert.rejects(release(),error=>error.code==='42501');}
    finally {await pg.exec('reset role; set role service_role');}
    assert.equal((await state()).payouts[0].status,'processing');
  });
}

test('partial reversal preserves the original paid earning and requires manual recovery',async()=>{
  const h=harness();
  assert.equal((await h.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  const s=await state();
  assert.deepEqual(s.payouts.map(x=>x.status),['paid','processing']);
  assert.deepEqual(s.earnings.map(x=>x.status),['paid','payout_processing']);
  assert.equal(s.earnings[0].payout_batch_id,id);
  assert.equal(s.earnings[0].payment_provider,'stripe');
  assert.equal(s.earnings[0].recovery_required,true);
  assert.equal(s.earnings[0].review_flag,'paid_payout_reversed_by_provider');
  assert.equal(s.earnings[0].metadata.released_payout_id,undefined);
  assert.equal(s.payouts[0].paid_at.toISOString(),'2023-11-14T22:13:20.000Z');
  assert.equal(s.earnings[1].recovery_required,false);
  assert.equal(s.audits.filter(x=>x.action==='payout_paid').length,1);
  assert.equal(s.audits.filter(x=>x.action==='release_payout_reservation').length,0);
  assert.equal(s.audits.find(x=>x.action==='paid_payout_recovery_required').metadata.automatic_debit_attempted,false);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
  assert.equal(h.calls.filter(c=>c.kind==='complete').length,1);
});
test('partial then full reversal never releases a paid earning for another automatic payout',async()=>{
  const h=harness();
  assert.equal((await h.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.equal((await h.deliver()).status,200);
  const s=await state();
  assert.equal(s.payouts[0].status,'paid');
  assert.equal(s.earnings[0].status,'paid');
  assert.equal(s.earnings[0].recovery_required,true);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
  assert.equal(h.calls.filter(c=>c.kind==='complete').length,1);
});
test('an old partial reversal after a completed full release leaves its terminal state intact',async()=>{
  await release();
  const prior=await state(),h=harness();
  assert.equal((await h.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.deepEqual(await state(),prior);
  assert.equal(h.calls.filter(c=>c.kind==='complete'||c.kind==='release').length,0);
});
test('an already-paid partial reversal uses manual recovery without a new completion',async()=>{
  await complete();
  const h=harness();
  assert.equal((await h.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.equal((await state()).earnings[0].recovery_required,true);
  assert.equal(h.calls.filter(c=>c.kind==='complete'||c.kind==='release').length,0);
});
test('a partial reversal cannot release a requested payout before its transfer is confirmed',async()=>{
  await pg.query("update public.dancer_payout_batches set status='requested' where id=$1",[id]);
  const prior=await state(),h=harness();
  await failed(await h.deliver(transferId,{amount_reversed:250,reversed:false}),h);
  assert.deepEqual(await state(),prior);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
test('a full release committed before partial completion is preserved and the stale attempt retries',async()=>{
  const h=harness({beforeCompletion:async()=>release()});
  await failed(await h.deliver(transferId,{amount_reversed:250,reversed:false}),h);
  const prior=await state(),retry=harness();
  assert.equal((await retry.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.deepEqual(await state(),prior);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
test('uncertain partial completion fails without releasing the reservation',async()=>{
  const prior=await state(),h=harness({completion:async()=>({data:null,error:null})});
  await failed(await h.deliver(transferId,{amount_reversed:250,reversed:false}),h);
  assert.deepEqual(await state(),prior);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
test('lost partial completion response is confirmed and recovery flags are retained',async()=>{
  const h=harness({completion:async()=>{await complete(); return {data:null,error:{code:'08006'}};}});
  assert.equal((await h.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.equal((await state()).earnings[0].status,'paid');
  assert.equal((await state()).earnings[0].recovery_required,true);
  assert.equal(h.calls.filter(c=>c.kind==='complete').length,1);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
test('partial recovery write failure retains paid state and an explicit retry completes recovery',async()=>{
  const h=harness({recoveryError:true});
  await failed(await h.deliver(transferId,{amount_reversed:250,reversed:false}),h);
  assert.equal((await state()).earnings[0].status,'paid');
  const retry=harness();
  assert.equal((await retry.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.equal((await state()).earnings[0].recovery_required,true);
  assert.equal(retry.calls.filter(c=>c.kind==='complete'||c.kind==='release').length,0);
});
for (const transfer of [
  {amount:0},{amount:-1},{amount:0.5},{amount:'1000'},{amount:null},
  {amount_reversed:0},{amount_reversed:-1},{amount_reversed:1001},
  {amount_reversed:0.5},{amount_reversed:'250'},{amount_reversed:null},
  {amount:Number.MAX_SAFE_INTEGER+1},{amount_reversed:Number.MAX_SAFE_INTEGER+1},
]) {
  test('invalid signed reversal amounts cannot release earnings: '+JSON.stringify(transfer),async()=>{
    const prior=await state(),h=harness();
    await failed(await h.deliver(transferId,transfer),h);
    assert.deepEqual(await state(),prior);
    assert.equal(h.calls.filter(c=>c.kind==='complete'||c.kind==='release').length,0);
  });
}

for (const created of [null,-1,'1700000000',Number.MAX_SAFE_INTEGER]) {
  test('invalid original transfer time cannot complete a partial reversal: '+String(created),async()=>{
    const prior=await state(),h=harness();
    await failed(await h.deliver(transferId,{amount_reversed:250,reversed:false,created}),h);
    assert.deepEqual(await state(),prior);
    assert.equal(h.calls.filter(c=>c.kind==='complete'||c.kind==='release').length,0);
  });
}
test('repeated partial deliveries keep one payout completion and never release earnings',async()=>{
  const h=harness();
  for(let i=0;i<2;i++) assert.equal((await h.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.equal((await state()).earnings[0].recovery_required,true);
  assert.equal((await state()).audits.filter(x=>x.action==='payout_paid').length,1);
  assert.equal(h.calls.filter(c=>c.kind==='complete').length,1);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
test('a concurrent completion of the same transfer is confirmed before partial recovery',async()=>{
  const h=harness({beforeCompletion:async()=>complete()});
  assert.equal((await h.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.equal((await state()).earnings[0].recovery_required,true);
  assert.equal((await state()).audits.filter(x=>x.action==='payout_paid').length,1);
  assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
test('a replaced transfer reference cannot receive partial recovery for the previous transfer',async()=>{
  const h=harness({beforeRead:async n=>{if(n===2) await pg.query('update public.dancer_payout_batches set provider_reference_id=$1 where id=$2',['tr_replaced',id]);}});
  await failed(await h.deliver(transferId,{amount_reversed:250,reversed:false}),h);
  const s=await state();
  assert.equal(s.earnings[0].status,'payout_processing');
  assert.equal(s.earnings[0].recovery_required,false);
  assert.equal(h.calls.filter(c=>c.kind==='complete'||c.kind==='release').length,0);
});
test('a thrown response after partial completion remains recoverable by explicit redelivery',async()=>{
  const h=harness({completion:async()=>{await complete(); throw new Error('Synthetic private completion failure');}});
  await failed(await h.deliver(transferId,{amount_reversed:250,reversed:false}),h);
  assert.equal((await state()).earnings[0].status,'paid');
  const retry=harness();
  assert.equal((await retry.deliver(transferId,{amount_reversed:250,reversed:false})).status,200);
  assert.equal((await state()).earnings[0].recovery_required,true);
  assert.equal(retry.calls.filter(c=>c.kind==='complete'||c.kind==='release').length,0);
});

const recoveryReceipt={id,status:'paid',providerReferenceId:transferId,recoveryRequired:true,earningCount:1,duplicate:false};
const invalidRecoveryReceipts=[
 ['null',null],['array',[]],['empty',{}],['wrong payout',{...recoveryReceipt,id:otherId}],
 ['wrong status',{...recoveryReceipt,status:'processing'}],['wrong provider reference',{...recoveryReceipt,providerReferenceId:'tr_unrelated'}],
 ['unconfirmed recovery',{...recoveryReceipt,recoveryRequired:false}],['string recovery flag',{...recoveryReceipt,recoveryRequired:'true'}],
 ['missing count',{...recoveryReceipt,earningCount:undefined}],['zero count',{...recoveryReceipt,earningCount:0}],
 ['negative count',{...recoveryReceipt,earningCount:-1}],['fractional count',{...recoveryReceipt,earningCount:1.5}],
 ['string count',{...recoveryReceipt,earningCount:'1'}],['unsafe count',{...recoveryReceipt,earningCount:Number.MAX_SAFE_INTEGER+1}],
 ['missing retry flag',{...recoveryReceipt,duplicate:undefined}],['string retry flag',{...recoveryReceipt,duplicate:'false'}],
];
for(const [label,data]of invalidRecoveryReceipts){
 test('uncommitted paid recovery with '+label+' cannot acknowledge the signed webhook',async()=>{
  await complete();const prior=await state(),h=harness({recovery:async()=>({data,error:null})});
  await failed(await h.deliver(),h);assert.deepEqual(await state(),prior);assert.equal(h.calls.filter(c=>c.kind==='recovery').length,1);
 });
 test('committed paid recovery with '+label+' stays retryable without duplicate audits',async()=>{
  await complete();const h=harness({recovery:async args=>{await recover(args);return {data,error:null};}});
  await failed(await h.deliver(),h);const prior=await state();assert.equal(prior.earnings[0].recovery_required,true);
  const retry=harness();assert.equal((await retry.deliver()).status,200);assert.deepEqual(await state(),prior);
  assert.equal(prior.audits.filter(a=>a.action==='paid_payout_recovery_required').length,1);assert.equal(retry.calls.filter(c=>c.kind==='recovery').length,1);
 });
}
test('an explicit error cannot be hidden by an apparently valid recovery receipt',async()=>{
 await complete();const prior=await state(),h=harness({recovery:async()=>({data:recoveryReceipt,error:{code:'08006',message:'Private error'}})});
 await failed(await h.deliver(),h);assert.deepEqual(await state(),prior);
});
test('a thrown recovery response after commit is safe to retry',async()=>{
 await complete();const h=harness({recovery:async args=>{await recover(args);throw new Error('Private response failure');}});
 await failed(await h.deliver(),h);const prior=await state(),retry=harness();assert.equal((await retry.deliver()).status,200);assert.deepEqual(await state(),prior);
});
test('audit failure rolls back recovery flags and signed redelivery can finish safely',async()=>{
 await complete();const prior=await state(),h=harness({auditError:true});await failed(await h.deliver(),h);assert.deepEqual(await state(),prior);
 const retry=harness();assert.equal((await retry.deliver()).status,200);assert.equal((await state()).audits.filter(a=>a.action==='paid_payout_recovery_required').length,1);
});
test('signed redelivery preserves an existing manual review reason and one recovery audit',async()=>{
 await complete();await pg.query("update commission_events set review_flag='manual_fraud_review' where id=$1",[id]);
 const h=harness();assert.equal((await h.deliver()).status,200);const prior=await state();assert.equal(prior.earnings[0].review_flag,'manual_fraud_review');
 assert.equal((await h.deliver()).status,200);assert.deepEqual(await state(),prior);
});
test('a provider reference changed after the initial read cannot receive old-transfer recovery',async()=>{
 await complete();const h=harness({beforeRecovery:async()=>pg.query("update dancer_payout_batches set provider_reference_id='tr_new_reference' where id=$1",[id])});
 await failed(await h.deliver(),h);assert.equal((await state()).earnings[0].recovery_required,false);assert.equal((await state()).audits.filter(a=>a.action==='paid_payout_recovery_required').length,0);
});
test('a payout state changed after the initial read cannot falsely acknowledge paid recovery',async()=>{
 await complete();const h=harness({beforeRecovery:async()=>pg.query("update dancer_payout_batches set status='failed' where id=$1",[id])});
 await failed(await h.deliver(),h);assert.equal((await state()).earnings[0].recovery_required,false);
});
test('missing payout items keep a paid reversal retryable and never release paid earnings',async()=>{
 await complete();await pg.query('delete from dancer_payout_items where payout_batch_id=$1',[id]);const prior=await state(),h=harness();
 await failed(await h.deliver(),h);assert.deepEqual(await state(),prior);assert.equal(h.calls.filter(c=>c.kind==='release').length,0);
});
