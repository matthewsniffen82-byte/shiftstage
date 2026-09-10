import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createPayoutDispatchDatabase,seedPayoutDispatchDatabase,claimPayoutDispatch,payoutSnapshot,payoutId,payoutSchema,payoutMigration,payoutSignature} from './helpers/payout-dispatch-database.mjs';
let pg;
before(async()=>{pg=await createPayoutDispatchDatabase();});
beforeEach(async()=>seedPayoutDispatchDatabase(pg));
after(async()=>pg?.close());
const mark=reference=>pg.query('select public.mark_dancer_payout_processing($1,$2)',[payoutId(10),reference]);

test('the previous marker can overwrite a known transfer with a retry dispatch key',async()=>{
 await mark('tr_synthetic_completed_dispatch');await mark('mydancr-payout-'+payoutId(10));
 const row=(await payoutSnapshot(pg)).dancer_payout_batches[0];assert.equal(row.provider_reference_id,'mydancr-payout-'+payoutId(10));
});
test('a fresh claim and its financial audit commit together while earnings remain reserved',async()=>{
 const before=await payoutSnapshot(pg),receipt=await claimPayoutDispatch(pg),after=await payoutSnapshot(pg);
 assert.deepEqual(receipt,{id:payoutId(10),status:'processing',claimed:true,dancerId:payoutId(1),amountCents:5000,currency:'usd',paymentProvider:'stripe',dispatchKey:'mydancr-payout-'+payoutId(10)});
 assert.deepEqual(after.commission_events,before.commission_events);assert.deepEqual(after.dancer_earning_status_history,before.dancer_earning_status_history);assert.deepEqual(after.nats_commission_exports,before.nats_commission_exports);
 assert.equal(after.financial_audit_events.length,1);assert.equal(after.financial_audit_events[0].action,'payout_processing');
 assert.deepEqual(after.dancer_payout_batches[0].metadata,{synthetic:'preserve'});
});
test('a second worker cannot acquire an already claimed dispatch or write another audit',async()=>{
 await claimPayoutDispatch(pg);const before=await payoutSnapshot(pg),again=await claimPayoutDispatch(pg);
 assert.deepEqual(again,{id:payoutId(10),status:'processing',claimed:false});assert.deepEqual(await payoutSnapshot(pg),before);
});
test('a known provider reference cannot be overwritten by a new claim',async()=>{
 await mark('tr_synthetic');const before=await payoutSnapshot(pg);
 assert.equal((await claimPayoutDispatch(pg)).claimed,false);assert.deepEqual(await payoutSnapshot(pg),before);
});
test('an old processing reservation never expires into automatic redispatch',async()=>{
 await claimPayoutDispatch(pg);await pg.exec("update public.dancer_payout_batches set processing_at='2020-01-01',updated_at='2020-01-01'");
 const before=await payoutSnapshot(pg);assert.equal((await claimPayoutDispatch(pg)).claimed,false);assert.deepEqual(await payoutSnapshot(pg),before);
});
test('a lost claim acknowledgment can be retried without a second permission to send',async()=>{
 await claimPayoutDispatch(pg);const retry=await claimPayoutDispatch(pg);assert.equal(retry.claimed,false);
 assert.equal((await payoutSnapshot(pg)).financial_audit_events.length,1);
});
for(const status of ['paid','failed','canceled'])test(status+' payouts return an unclaimed receipt without mutation',async()=>{
 await pg.query('update public.dancer_payout_batches set status=$1',[status]);const before=await payoutSnapshot(pg);
 assert.deepEqual(await claimPayoutDispatch(pg),{id:payoutId(10),status,claimed:false});assert.deepEqual(await payoutSnapshot(pg),before);
});
for(const column of ['provider_reference_id','external_reference','stripe_transfer_id','processing_at','paid_at','failed_at','canceled_at'])test('a requested payout with existing '+column+' requires reconciliation',async()=>{
 await pg.query('update public.dancer_payout_batches set '+column+'=$1',[column.endsWith('_at')?'2020-01-01T00:00:00Z':'synthetic-existing']);
 const before=await payoutSnapshot(pg);await assert.rejects(claimPayoutDispatch(pg),{code:'40001'});assert.deepEqual(await payoutSnapshot(pg),before);
});
test('an explicit dispatch review flag prevents new dispatch even if status says requested',async()=>{
 await pg.exec("update public.dancer_payout_batches set metadata=metadata||'{\"dispatch_review_required\":true}'");const before=await payoutSnapshot(pg);
 await assert.rejects(claimPayoutDispatch(pg),{code:'40001'});assert.deepEqual(await payoutSnapshot(pg),before);
});
test('test payouts cannot be sent through the production claim',async()=>{
 await pg.exec('update public.dancer_payout_batches set is_test=true');const before=await payoutSnapshot(pg);
 await assert.rejects(claimPayoutDispatch(pg),{code:'22023'});assert.deepEqual(await payoutSnapshot(pg),before);
});
test('non-USD payouts remain unsupported',async()=>{
 await pg.exec("update public.dancer_payout_batches set currency='eur'");const before=await payoutSnapshot(pg);
 await assert.rejects(claimPayoutDispatch(pg),{code:'22023'});assert.deepEqual(await payoutSnapshot(pg),before);
});
for(const provider of ['adyen','other'])test(provider+' keeps its provider identity in the claim',async()=>{
 await pg.query('update public.dancer_payout_batches set payment_provider=$1',[provider]);const receipt=await claimPayoutDispatch(pg);
 assert.equal(receipt.paymentProvider,provider);assert.equal((await payoutSnapshot(pg)).dancer_payout_batches[0].stripe_transfer_id,null);
});
test('retired provider protection remains active',async()=>{
 await assert.rejects(pg.exec("update public.dancer_payout_batches set payment_provider='bitsafe'"),{code:'22023'});
});
test('missing and null payout IDs cannot create records',async()=>{
 const before=await payoutSnapshot(pg);await assert.rejects(claimPayoutDispatch(pg,null),{code:'22023'});await assert.rejects(claimPayoutDispatch(pg,payoutId(99)),{code:'P0002'});assert.deepEqual(await payoutSnapshot(pg),before);
});
for(const [table,operation]of [['dancer_payout_batches','UPDATE'],['financial_audit_events','INSERT']])test(table+' failure rolls back the dispatch claim',async()=>{
 const before=await payoutSnapshot(pg);
 await pg.exec("reset role;create or replace function public.synthetic_payout_failure() returns trigger language plpgsql as $$begin raise exception using errcode='P0001',message='synthetic failure';end$$;create trigger synthetic_failure after "+operation+' on public.'+table+' for each row execute function public.synthetic_payout_failure();set role service_role');
 await assert.rejects(claimPayoutDispatch(pg),{code:'P0001'});assert.deepEqual(await payoutSnapshot(pg),before);
});
for(const body of ["new.amount_cents:=6000;return new;","return null;"])test('a changed or skipped row update rolls back the claim and audit: '+body,async()=>{
 const before=await payoutSnapshot(pg);
 await pg.exec('reset role;create or replace function public.synthetic_payout_failure() returns trigger language plpgsql as $$begin '+body+'end$$;create trigger synthetic_failure before update on public.dancer_payout_batches for each row execute function public.synthetic_payout_failure();set role service_role');
 await assert.rejects(claimPayoutDispatch(pg),{code:'40001'});assert.deepEqual(await payoutSnapshot(pg),before);
});
test('an unconfirmed nested marker result cannot grant permission to send',async()=>{
 const before=await payoutSnapshot(pg);
 await pg.exec('reset role;create or replace function public.mark_dancer_payout_processing(p_payout_id uuid,p_provider_reference_id text) returns jsonb language sql as $$select null::jsonb$$;set role service_role');
 await assert.rejects(claimPayoutDispatch(pg),{code:'40001'});assert.deepEqual(await payoutSnapshot(pg),before);
});
test('queued workers receive exactly one fresh dispatch receipt; local calls are serialized',async()=>{
 const receipts=await Promise.all(Array.from({length:8},()=>claimPayoutDispatch(pg)));
 assert.equal(receipts.filter(r=>r.claimed).length,1);assert.equal((await payoutSnapshot(pg)).financial_audit_events.length,1);
});
for(const role of ['anon','authenticated'])test(role+' cannot claim or modify a payout',async()=>{
 await pg.exec('set role '+role);await assert.rejects(claimPayoutDispatch(pg),{code:'42501'});
 await assert.rejects(pg.exec("update public.dancer_payout_batches set status='paid'"),{code:'42501'});
});
test('financial records retain their deletion protections',async()=>{
 await claimPayoutDispatch(pg);for(const table of ['dancer_payout_batches','commission_events','financial_audit_events'])await assert.rejects(pg.exec('delete from public.'+table),{code:'22023'});
});
test('migration repeat preserves data, original functions and service-only invoker security',async()=>{
 await claimPayoutDispatch(pg);const before=await payoutSnapshot(pg);await pg.exec('reset role');await pg.exec(payoutMigration);await pg.exec(payoutMigration);assert.deepEqual(await payoutSnapshot(pg),before);
 for(const fn of payoutSchema.functions)assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+fn.signature])).rows[0].hash,fn.fingerprint);
 const row=(await pg.query("select p.prosecdef,p.proconfig,has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p where oid=$1::regprocedure",[payoutSignature])).rows[0];
 assert.equal(row.prosecdef,false);assert.ok(row.proconfig.includes('search_path=""'));assert.ok(row.proconfig.includes('lock_timeout=3s'));assert.equal(row.service,true);assert.equal(row.anon,false);assert.equal(row.authenticated,false);
});
