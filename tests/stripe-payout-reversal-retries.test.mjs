import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test, {before, beforeEach, after} from 'node:test';
import ts from 'typescript';
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {readBoundedRequestBytes} from '../src/lib/bounded-json-body.ts';
import {resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
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
    'create table public.dancer_payout_batches(id uuid primary key, status text not null, provider_reference_id text unique, external_reference text, paid_at timestamptz, failed_at timestamptz, canceled_at timestamptz, failure_message text, updated_at timestamptz not null);',
    "create table public.commission_events(id uuid primary key, payout_batch_id uuid, status text not null, paid_at timestamptz, payment_provider text, metadata jsonb not null default '{}', recovery_required boolean not null default false, review_flag text);",
    'create table public.financial_audit_events(actor_type text, action text, target_type text, target_id text, after_state jsonb, reason text, metadata jsonb);',
    'alter table public.dancer_payout_batches enable row level security;',
    'alter table public.commission_events enable row level security;',
    'alter table public.financial_audit_events enable row level security;',
    'grant all on public.dancer_payout_batches, public.commission_events, public.financial_audit_events to service_role;',
  ].join('\n'));
  for (const [file, signature] of [
    ['stripe-payout-release.sql', 'release_dancer_payout_batch(uuid,text,text)'],
    ['stripe-payout-completion.sql', 'complete_dancer_payout_batch(uuid,text,timestamptz)'],
  ]) {
    await pg.exec(read('./fixtures/' + file).replace(/\r\n/g, '\n'));
    await pg.exec('revoke all on function public.' + signature + ' from public,anon,authenticated; grant execute on function public.' + signature + ' to service_role;');
  }
});
after(async () => pg?.close());
beforeEach(async () => {
  await pg.exec('reset role; truncate public.dancer_payout_batches, public.commission_events, public.financial_audit_events; set role service_role');
  for (const [key, ref] of [[id, transferId], [otherId, 'tr_unrelated']]) {
    await pg.query("insert into public.dancer_payout_batches(id,status,provider_reference_id,updated_at) values($1,'processing',$2,$3)", [key,ref,initialTime]);
    await pg.query("insert into public.commission_events(id,payout_batch_id,status,payment_provider,metadata) values($1,$1,'payout_processing','stripe','{\"existing\":true}')", [key]);
  }
});
async function release(payoutId = id, status = 'failed') {
  return (await pg.query('select public.release_dancer_payout_batch($1,$2,$3) result', [payoutId,status,'Synthetic reversal'])).rows[0].result;
}
async function complete(payoutId = id, reference = transferId) {
  return (await pg.query('select public.complete_dancer_payout_batch($1,$2,$3) result', [payoutId,reference,initialTime])).rows[0].result;
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
function harness({rpc, beforeRpc, readErrorAt=0, beforeRead, recoveryError=false, auditError=false} = {}) {
  const calls=[], finished=[];
  let reads=0, sequence=0;
  const allowed = {
    dancer_payout_batches:new Set(['id','status','provider_reference_id']),
    commission_events:new Set(['payout_batch_id','status','recovery_required','review_flag']),
    financial_audit_events:new Set(['actor_type','action','target_type','target_id','reason','metadata']),
  };
  const client = {
    async rpc(name,args) {
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
      finishPaymentProviderWebhook:async(...args)=>finished.push(args[3]?'failed':'processed'),
    },
    '@/src/lib/server-env':{getServerEnv:()=>secret},
    '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},stripe:Stripe,
  });
  async function deliver(reference=transferId) {
    const payload=JSON.stringify({id:'evt_reversal_synthetic_'+(++sequence),type:'transfer.reversed',created:1700000000,data:{object:{id:reference,object:'transfer',amount:1000,amount_reversed:1000,reversed:true}}});
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
