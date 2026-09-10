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
const transferId = 'tr_synthetic';
const secret = 'synthetic-payout-webhook-secret';
const initialTime = '2020-01-01T00:00:00.000Z';
let pg;

before(async () => {
  pg = new PGlite();
  await pg.exec([
    'create role anon; create role authenticated; create role service_role bypassrls;',
    'create table public.dancer_payout_batches(id uuid primary key, status text not null, provider_reference_id text unique, external_reference text, paid_at timestamptz, failure_message text, updated_at timestamptz not null);',
    'create table public.commission_events(id uuid primary key, payout_batch_id uuid, status text not null, paid_at timestamptz);',
    'create table public.financial_audit_events(actor_type text, action text, target_type text, target_id text, after_state jsonb);',
    'alter table public.dancer_payout_batches enable row level security;',
    'alter table public.commission_events enable row level security;',
    'alter table public.financial_audit_events enable row level security;',
    'grant all on public.dancer_payout_batches, public.commission_events, public.financial_audit_events to service_role;',
  ].join('\n'));
  // Captured live function, with only checkout line endings normalized.
  await pg.exec(read('./fixtures/stripe-payout-completion.sql').replace(/\r\n/g, '\n'));
  await pg.exec('revoke all on function public.complete_dancer_payout_batch(uuid,text,timestamptz) from public,anon,authenticated; grant execute on function public.complete_dancer_payout_batch(uuid,text,timestamptz) to service_role;');
});
after(async () => pg?.close());
beforeEach(async () => {
  await pg.exec('reset role; truncate public.dancer_payout_batches, public.commission_events, public.financial_audit_events; set role service_role');
  await seed();
  await pg.query("insert into public.commission_events(id,payout_batch_id,status) values($1,$1,'payout_processing'),($2,$2,'payout_processing')", [id, otherId]);
});
async function seed({payoutId = id, status = 'processing', reference = transferId} = {}) {
  await pg.query('insert into public.dancer_payout_batches(id,status,provider_reference_id,updated_at) values($1,$2,$3,$4)', [payoutId,status,reference,initialTime]);
}
const row = async (payoutId = id) => (await pg.query('select * from public.dancer_payout_batches where id=$1', [payoutId])).rows[0];
const state = async () => ({
  payouts: (await pg.query('select * from public.dancer_payout_batches order by id')).rows,
  earnings: (await pg.query('select * from public.commission_events order by id')).rows,
  audits: (await pg.query('select * from public.financial_audit_events order by target_id')).rows,
});
async function complete(payoutId = id, reference = transferId) {
  const {rows} = await pg.query('select public.complete_dancer_payout_batch($1,$2,$3) as result', [payoutId,reference,initialTime]);
  return rows[0].result;
}
function module(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), {
    compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true},
  }).outputText, {
    exports, Buffer, Date, Headers, console:{warn(){}, error(){}},
    require:name => {
      if (Object.hasOwn(dependencies,name)) return dependencies[name];
      throw new Error('Unexpected dependency ' + name);
    },
  });
  return exports;
}
function harness({rpc, beforeRpc, readErrorAt = 0} = {}) {
  const calls = [], finished = [];
  let reads = 0, sequence = 0;
  const client = {
    async rpc(name,args) {
      assert.equal(name,'complete_dancer_payout_batch');
      calls.push({kind:'complete',args});
      await beforeRpc?.();
      if (rpc) return rpc(args);
      try {
        const {rows} = await pg.query('select public.complete_dancer_payout_batch($1,$2,$3) as result', [args.p_batch_id,args.p_transfer_id,args.p_paid_at]);
        return {data:rows[0].result,error:null};
      } catch (error) {
        return {data:null,error};
      }
    },
    from(table) {
      assert.equal(table,'dancer_payout_batches');
      const filters = [];
      let selection;
      const allowed = new Set(['id','status','provider_reference_id']);
      const query = {
        select(value) {selection=value; return query;},
        eq(key,value) {assert.ok(allowed.has(key)); filters.push([key,value]); return query;},
        async maybeSingle() {
          reads++;
          calls.push({kind:'read',filters,selection});
          if (reads === readErrorAt) return {data:null,error:{code:'08006',message:'Synthetic private SQL detail'}};
          const columns = selection.split(',').map(key => {key=key.trim(); assert.ok(allowed.has(key)); return key;}).join(',');
          const sql = 'select ' + columns + ' from public.dancer_payout_batches where ' + filters.map(([key],index) => key+'=$'+(index+1)).join(' and ');
          const {rows} = await pg.query(sql,filters.map(([,value]) => value));
          assert.ok(rows.length <= 1);
          return {data:rows[0] || null,error:null};
        },
      };
      return query;
    },
  };
  const events = module('../src/lib/dancr/finance-provider-events.ts', {
    './finance-audit-log':{}, './payout-account-store':{}, './payout-provider':{}, '../stripe':{},
  });
  const route = module('../app/api/stripe/webhook/route.ts', {
    'next/server':{NextResponse:{json:Response.json}},
    '@/src/lib/api':{apiError:(error,fallback) => {
      const result=resolveApiError(error,fallback); return Response.json(result.body,{status:result.status});
    }},
    '@/src/lib/bounded-json-body':{readBoundedRequestBytes},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:() => client},
    '@/src/lib/dancr/payments':{},
    '@/src/lib/dancr/finance-provider-events':{
      ...events,
      recordPaymentProviderWebhook:async () => true,
      finishPaymentProviderWebhook:async (...args) => finished.push(args[3] ? 'failed' : 'processed'),
    },
    '@/src/lib/server-env':{getServerEnv:() => secret},
    '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},
    stripe:Stripe,
  });
  async function deliver({reference=transferId, internalId=id} = {}) {
    const payload=JSON.stringify({
      id:'evt_payout_synthetic_'+(++sequence),type:'transfer.created',created:1700000000,
      data:{object:{id:reference,object:'transfer',metadata:internalId ? {payout_batch_id:internalId} : {}}},
    });
    const signature=Stripe.webhooks.generateTestHeaderString({payload,secret});
    return route.POST(new Request('https://example.test/api/stripe/webhook',{
      method:'POST',headers:{'stripe-signature':signature},body:payload,
    }));
  }
  return {deliver,calls,finished,events,client};
}
async function failed(response,h) {
  assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{ok:false,error:'Unable to process Stripe webhook.'});
  assert.deepEqual(h.finished,['failed']);
  assert.ok(h.calls.filter(call => call.kind==='complete').length <= 1, 'Never retry a financial write in the handler');
}

test('processing payout completes once, updates only its reserved earnings and records one audit event', async () => {
  const h=harness();
  assert.equal((await h.deliver()).status,200);
  const result=await state();
  assert.equal(result.payouts[0].status,'paid');
  assert.equal(result.payouts[0].provider_reference_id,transferId);
  assert.deepEqual(result.earnings.map(item => item.status),['paid','payout_processing']);
  assert.equal(result.audits.length,1);
  assert.equal(result.audits[0].action,'payout_paid');
  assert.equal(h.calls.filter(call => call.kind==='complete').length,1);
  assert.deepEqual(h.finished,['processed']);
});

test('another signed event for an already paid transfer preserves timestamps, earnings and audit history', async () => {
  await complete();
  const before=await state(), h=harness();
  assert.equal((await h.deliver()).status,200);
  assert.deepEqual(await state(),before);
  assert.equal(h.calls.filter(call => call.kind==='complete').length,0);
  assert.deepEqual(h.finished,['processed']);
});

test('two sequential signed events for one transfer make exactly one financial write', async () => {
  const h=harness();
  assert.equal((await h.deliver()).status,200);
  const before=await state();
  assert.equal((await h.deliver()).status,200);
  assert.deepEqual(await state(),before);
  assert.equal(h.calls.filter(call => call.kind==='complete').length,1);
});

test('metadata fallback still completes a processing payout before its transfer reference is stored', async () => {
  await pg.query('update public.dancer_payout_batches set provider_reference_id=$1 where id=$2',['mydancr-payout-'+id,id]);
  const h=harness();
  assert.equal((await h.deliver()).status,200);
  assert.equal((await row()).provider_reference_id,transferId);
  assert.equal((await state()).audits.length,1);
});

test('a transfer with no matching payout performs no financial write', async () => {
  const before=await state(),h=harness();
  assert.equal((await h.deliver({reference:'tr_unrelated',internalId:null})).status,200);
  assert.deepEqual(await state(),before);
  assert.equal(h.calls.filter(call => call.kind==='complete').length,0);
});

test('fallback does not claim an already paid payout belonging to a different transfer', async () => {
  await complete();
  const before=await state(),h=harness();
  assert.equal((await h.deliver({reference:'tr_other'})).status,200);
  assert.deepEqual(await state(),before);
  assert.equal(h.calls.filter(call => call.kind==='complete').length,0);
});

for (const status of ['requested','failed','cancelled']) {
  test('a stored '+status+' payout is not acknowledged as paid or changed', async () => {
    await pg.query('update public.dancer_payout_batches set status=$1 where id=$2',[status,id]);
    const before=await state(),h=harness();
    await failed(await h.deliver(),h);
    assert.deepEqual(await state(),before);
  });
}

for (const mode of ['error','empty','malformed']) {
  test('a committed payout with '+mode+' acknowledgment is confirmed without another financial write', async () => {
    const h=harness({rpc:async () => {
      await complete();
      return mode==='error'
        ? {data:null,error:{code:'08006',message:'Synthetic private provider detail'}}
        : {data:mode==='empty' ? null : {id:otherId,status:'paid',provider_reference_id:'tr_wrong'},error:null};
    }});
    assert.equal((await h.deliver()).status,200);
    assert.equal((await row()).status,'paid');
    assert.equal((await state()).audits.length,1);
    assert.equal(h.calls.filter(call => call.kind==='complete').length,1);
    assert.deepEqual(h.finished,['processed']);
  });
}

test('another delivery completing the same payout between lookup and RPC is safely confirmed', async () => {
  const h=harness({beforeRpc:() => complete()});
  assert.equal((await h.deliver()).status,200);
  assert.equal((await state()).audits.length,1);
  assert.equal(h.calls.filter(call => call.kind==='complete').length,1);
});

test('a competing completion with a different transfer reference cannot satisfy confirmation', async () => {
  const h=harness({beforeRpc:() => complete(id,'tr_competing')});
  await failed(await h.deliver(),h);
  assert.equal((await row()).provider_reference_id,'tr_competing');
  assert.equal((await state()).audits.length,1);
});

for (const status of ['failed','requested']) {
  test('a concurrent '+status+' state is preserved and cannot satisfy confirmation', async () => {
    const h=harness({beforeRpc:() => pg.query('update public.dancer_payout_batches set status=$1 where id=$2',[status,id])});
    await failed(await h.deliver(),h);
    assert.equal((await row()).status,status);
    assert.equal((await state()).audits.length,0);
  });
}

test('an uncommitted RPC error fails generically and does not fabricate success', async () => {
  const before=await state(),h=harness({rpc:async () => ({data:null,error:{code:'08006',message:'Synthetic private SQL detail'}})});
  await failed(await h.deliver(),h);
  assert.deepEqual(await state(),before);
});

for (const data of [null,{}, {id:otherId,status:'paid',provider_reference_id:transferId},
  {id,status:'processing',provider_reference_id:transferId}, {id,status:'paid',provider_reference_id:'tr_wrong'}]) {
  test('an unconfirmed RPC result '+JSON.stringify(data)+' fails without changing financial records', async () => {
    const before=await state(),h=harness({rpc:async () => ({data,error:null})});
    await failed(await h.deliver(),h);
    assert.deepEqual(await state(),before);
  });
}

test('confirmation is scoped to the original payout ID as well as the transfer reference', async () => {
  await seed({payoutId:otherId,reference:'tr_other'});
  const h=harness({rpc:async () => {
    await pg.query('update public.dancer_payout_batches set provider_reference_id=null where id=$1',[id]);
    await complete(otherId,transferId);
    return {data:null,error:{code:'08006',message:'Synthetic lost response'}};
  }});
  await failed(await h.deliver(),h);
  assert.equal((await row()).status,'processing');
  assert.equal((await row(otherId)).status,'paid');
  assert.equal((await state()).audits.length,1);
});

test('initial lookup failure returns a generic error without financial work', async () => {
  const before=await state(),h=harness({readErrorAt:1});
  await failed(await h.deliver(),h);
  assert.deepEqual(await state(),before);
  assert.equal(h.calls.filter(call => call.kind==='complete').length,0);
});

test('metadata fallback lookup failure returns a generic error without financial work', async () => {
  await pg.query('update public.dancer_payout_batches set provider_reference_id=null where id=$1',[id]);
  const before=await state(),h=harness({readErrorAt:2});
  await failed(await h.deliver(),h);
  assert.deepEqual(await state(),before);
  assert.equal(h.calls.filter(call => call.kind==='complete').length,0);
});

test('a failed confirmation read does not acknowledge an uncertain completion', async () => {
  const h=harness({readErrorAt:2,rpc:async () => {
    await complete(); return {data:null,error:{code:'08006',message:'Synthetic lost response'}};
  }});
  await failed(await h.deliver(),h);
  assert.equal((await state()).audits.length,1);
});

test('a thrown transport error after commit can be retried safely by the next delivery', async () => {
  const first=harness({rpc:async () => {await complete(); throw new Error('Synthetic private transport error');}});
  await failed(await first.deliver(),first);
  const before=await state(),retry=harness();
  assert.equal((await retry.deliver()).status,200);
  assert.deepEqual(await state(),before);
  assert.equal(retry.calls.filter(call => call.kind==='complete').length,0);
});

for (const role of ['anon','authenticated']) {
  test(role+' still cannot invoke the captured privileged payout completion function', async () => {
    const before=await state();
    await pg.exec('set role '+role);
    await assert.rejects(() => complete(),error => error.code==='42501');
    await pg.exec('set role service_role');
    assert.deepEqual(await state(),before);
  });
}
