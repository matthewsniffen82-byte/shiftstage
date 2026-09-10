import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {database,reset,row,insertCurrent,harness,account,dancerId,otherId} from './helpers/payout-account-fixture.mjs';

let db;
before(async()=>{db=await database();});
after(async()=>db?.close());
beforeEach(async()=>reset(db));
const writes=h=>h.calls.filter(c=>['upsert','update'].includes(c.kind));
async function failed(response,h){
  assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{ok:false,error:'Unable to process Stripe webhook.'});
  assert.deepEqual(h.finished,['failed']);
  assert.ok(writes(h).length<=1);
}

test('a stale eligible snapshot stores the current restricted provider state',async()=>{
  const h=harness(db,{current:account(false)});
  assert.equal((await h.deliver(account(true))).status,200);
  const result=await row(db);
  assert.equal(result.payout_eligibility,'restricted');assert.equal(result.verification_status,'restricted');
  assert.equal(result.payouts_enabled,false);assert.equal(h.calls.filter(c=>c.kind==='provider-read').length,1);
  assert.deepEqual(h.finished,['processed']);
});
test('a stale restricted snapshot respects current provider approval',async()=>{
  const h=harness(db,{current:account(true)});
  assert.equal((await h.deliver(account(false))).status,200);
  assert.equal((await row(db)).payout_eligibility,'eligible');assert.equal((await row(db)).verification_status,'verified');
});
test('a new webhook account stores current state with existing private defaults and no financial dispatch',async()=>{
  await reset(db,{seed:false});
  const h=harness(db,{current:account(false)});
  assert.equal((await h.deliver()).status,200);
  const result=await row(db);
  assert.equal(result.dancer_id,dancerId);assert.equal(result.provider_account_id,'acct_synthetic');
  assert.equal(result.payout_eligibility,'restricted');
  assert.equal(h.calls.some(c=>c.kind==='provider-create'||c.kind==='provider-link'),false);
});
test('an event for a former provider account cannot replace the current account',async()=>{
  const before=await row(db),h=harness(db);
  assert.equal((await h.deliver(account(true,{id:'acct_former'}))).status,200);
  assert.deepEqual(await row(db),before);assert.equal(writes(h).length,0);
  assert.equal(h.calls.some(c=>c.kind==='provider-read'),false);
});
test('missing snapshot ownership metadata performs no work',async()=>{
  const before=await row(db),h=harness(db);
  assert.equal((await h.deliver(account(true,{metadata:{}}))).status,200);
  assert.deepEqual(await row(db),before);assert.equal(h.calls.length,0);
});
test('equivalent uppercase UUID metadata remains supported',async()=>{
  const h=harness(db,{current:account(true,{metadata:{dancer_id:dancerId.toUpperCase()}})});
  assert.equal((await h.deliver(account(false,{metadata:{dancer_id:dancerId.toUpperCase()}}))).status,200);
  assert.equal((await row(db)).payout_eligibility,'eligible');
});
for(const current of [account(true,{id:'acct_other'}),account(true,{metadata:{dancer_id:otherId}}),account(true,{metadata:{}})]){
  test('unconfirmed current provider identity '+JSON.stringify(current.metadata)+' / '+current.id+' cannot mutate an account',async()=>{
    const before=await row(db),h=harness(db,{current});
    await failed(await h.deliver(),h);
    assert.deepEqual(await row(db),before);assert.equal(writes(h).length,0);
    assert.equal(await row(db,otherId),null);
  });
}
test('provider retrieval failure never falls back to the signed stale snapshot',async()=>{
  const before=await row(db),h=harness(db,{retrieveError:new Error('Synthetic private provider error')});
  await failed(await h.deliver(),h);assert.deepEqual(await row(db),before);assert.equal(writes(h).length,0);
});
test('a database lookup error is not treated as a missing account',async()=>{
  const before=await row(db),h=harness(db,{readError:{code:'08006',message:'Synthetic private SQL detail'}});
  await failed(await h.deliver(),h);assert.deepEqual(await row(db),before);
  assert.equal(h.calls.some(c=>c.kind==='provider-read'),false);assert.equal(writes(h).length,0);
});
for(const timing of ['during provider read','immediately before UPDATE']){
  test('a newer account state committed '+timing+' is preserved',async()=>{
    const advance=()=>db.query("update public.dancer_payout_accounts set payout_eligibility='restricted',verification_status='restricted',updated_at='2030-01-01' where dancer_id=$1",[dancerId]);
    const h=harness(db,timing==='during provider read'?{retrieve:async()=>{await advance();return account(true);}}:{beforeWrite:advance});
    await failed(await h.deliver(),h);
    assert.equal((await row(db)).payout_eligibility,'restricted');
  });
}
test('an account inserted concurrently with a webhook is preserved for a fresh explicit redelivery',async()=>{
  await reset(db,{seed:false});
  const h=harness(db,{retrieve:async()=>{await insertCurrent(db);return account(true);}});
  await failed(await h.deliver(),h);
  assert.equal((await row(db)).payout_eligibility,'restricted');
  const retry=harness(db,{current:account(false)});
  assert.equal((await retry.deliver()).status,200);
  assert.equal((await row(db)).payout_eligibility,'restricted');
});
test('an intervening account replacement cannot be overwritten by a stale update',async()=>{
  const h=harness(db,{beforeWrite:()=>db.query("update public.dancer_payout_accounts set provider_account_id='acct_replacement',stripe_account_id='acct_replacement' where dancer_id=$1",[dancerId])});
  await failed(await h.deliver(),h);
  assert.equal((await row(db)).provider_account_id,'acct_replacement');
});
test('an unrelated dancer account remains unchanged',async()=>{
  await insertCurrent(db,{owner:otherId,reference:'acct_other'});
  const before=await row(db,otherId),h=harness(db);
  assert.equal((await h.deliver()).status,200);
  assert.deepEqual(await row(db,otherId),before);
});
test('a legacy unbound provider reference can bind through its captured version',async()=>{
  await db.query('update public.dancer_payout_accounts set provider_account_id=null,stripe_account_id=null where dancer_id=$1',[dancerId]);
  const h=harness(db);
  assert.equal((await h.deliver()).status,200);
  assert.equal((await row(db)).provider_account_id,'acct_synthetic');
});
for(const option of ['writeError','afterCommitError','missingAck']){
  test(option+' cannot report confirmed account synchronization',async()=>{
    const h=harness(db,{[option]:option==='missingAck'?true:{code:'08006',message:'Synthetic private SQL detail'}});
    await failed(await h.deliver(),h);assert.equal(writes(h).length,1);
  });
}
test('a fresh explicit delivery after a lost write acknowledgment succeeds without a blind retry',async()=>{
  const first=harness(db,{afterCommitError:{code:'08006'}});
  await failed(await first.deliver(),first);
  const retry=harness(db,{current:account(false)});
  assert.equal((await retry.deliver()).status,200);
  assert.equal(writes(first).length,1);assert.equal(writes(retry).length,1);
  assert.equal((await row(db)).payout_eligibility,'restricted');
});
test('the version advances even with a frozen clock and a previous microsecond timestamp',async()=>{
  await reset(db,{updatedAt:'2030-01-01T00:00:00.123456Z'});
  class FrozenDate extends Date{static now(){return Date.parse('2030-01-01T00:00:00.123Z');}}
  const h=harness(db,{Clock:FrozenDate}),previous=await row(db),state=h.provider.stripeAccountState(account(true));
  await h.store.upsertDancerPayoutAccount(h.client,dancerId,'stripe',state,previous);
  const confirmed=await row(db);
  assert.ok(Date.parse(confirmed.updated_at)>Date.parse(previous.updated_at));
  await assert.rejects(h.store.upsertDancerPayoutAccount(h.client,dancerId,'stripe',h.provider.stripeAccountState(account(false)),previous));
  assert.equal((await row(db)).payout_eligibility,'eligible');
});
for(const change of [undefined,{updated_at:'invalid'},{dancer_id:otherId},{payment_provider:'other'},{provider_account_id:'acct_other'}]){
  test('invalid captured version '+JSON.stringify(change)+' is rejected before writes',async()=>{
    const before=await row(db),h=harness(db);
    await assert.rejects(h.store.upsertDancerPayoutAccount(h.client,dancerId,'stripe',h.provider.stripeAccountState(account()),change===undefined?undefined:{...before,...change}));
    assert.deepEqual(await row(db),before);assert.equal(writes(h).length,0);
  });
}
test('owner refresh reads current provider state and preserves the captured account identity',async()=>{
  const h=harness(db,{current:account(false)});
  await h.refresh();assert.equal((await row(db)).payout_eligibility,'restricted');
  assert.equal(writes(h).length,1);
});
test('owner refresh cannot overwrite a newer webhook result',async()=>{
  const h=harness(db,{retrieve:async()=>{await db.query("update public.dancer_payout_accounts set payout_eligibility='restricted',updated_at='2030-01-01' where dancer_id=$1",[dancerId]);return account(true);}});
  await assert.rejects(h.refresh());
  assert.equal((await row(db)).payout_eligibility,'restricted');
});
test('initial onboarding creates one account and then its link',async()=>{
  await reset(db,{seed:false});
  const h=harness(db);
  assert.equal((await h.onboard()).url,'https://connect.example.test/synthetic');
  assert.equal(h.calls.filter(c=>c.kind==='provider-create').length,1);
  assert.equal(h.calls.filter(c=>c.kind==='provider-link').length,1);
});
test('onboarding preserves an account created by an overlapping webhook and works on explicit retry',async()=>{
  await reset(db,{seed:false});
  const h=harness(db,{create:async()=>{await insertCurrent(db);return account(true);}});
  await assert.rejects(h.onboard());
  assert.equal((await row(db)).payout_eligibility,'restricted');
  assert.equal(h.calls.filter(c=>c.kind==='provider-link').length,0);
  assert.equal((await h.onboard()).url,'https://connect.example.test/synthetic');
  assert.equal(h.calls.filter(c=>c.kind==='provider-create').length,1);
  assert.equal((await row(db)).payout_eligibility,'restricted');
});
test('refresh with no stored account performs no provider request',async()=>{
  await reset(db,{seed:false});
  const h=harness(db);
  assert.equal(await h.refresh(),null);assert.equal(writes(h).length,0);
  assert.equal(h.calls.some(c=>c.kind==='provider-read'),false);
});
for(const options of [{enabled:false},{nats:true}]){
  test('existing payout activation gate '+JSON.stringify(options)+' remains closed',async()=>{
    const before=await row(db),h=harness(db,options);
    await assert.rejects(h.onboard());assert.equal(await h.refresh(),null);
    assert.deepEqual(await row(db),before);assert.equal(h.calls.length,0);
  });
}
