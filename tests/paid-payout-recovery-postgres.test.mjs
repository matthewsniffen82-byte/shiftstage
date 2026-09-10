import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createPaidRecoveryDatabase,seedPaidRecoveryDatabase,flagPaidRecovery,recoverySnapshot,recoveryMigration,recoverySignature,payoutId} from './helpers/paid-payout-recovery-database.mjs';
let pg,payout;
before(async()=>{pg=await createPaidRecoveryDatabase();});
beforeEach(async()=>{payout=await seedPaidRecoveryDatabase(pg);});
after(async()=>pg?.close());
const flag=(changes={})=>flagPaidRecovery(pg,{...payout,...changes}),snapshot=()=>recoverySnapshot(pg);
const audits=s=>s.financial_audit_events.filter(r=>r.action==='paid_payout_recovery_required');

test('paid recovery flags and its audit commit together without changing money or other records',async()=>{
 const before=await snapshot(),receipt=await flag(),after=await snapshot();
 assert.deepEqual(receipt,{id:payout.id,status:'paid',providerReferenceId:payout.reference,recoveryRequired:true,earningCount:1,duplicate:false});
 const expected=structuredClone(before);const earning=expected.commission_events.find(e=>e.payout_batch_id===payout.id);
 earning.recovery_required=true;earning.review_flag='paid_payout_reversed_by_provider';
 expected.financial_audit_events=after.financial_audit_events;assert.deepEqual(after,expected);assert.equal(audits(after).length,1);
 const audit=audits(after)[0];assert.equal(audit.target_id,payout.id);assert.equal(audit.reason,'Synthetic provider reversal');assert.deepEqual(audit.metadata,{provider_reference_id:payout.reference,automatic_debit_attempted:false});
});
test('a lost acknowledgment can be retried without another audit or financial write',async()=>{
 await flag();const before=await snapshot();assert.equal((await flag()).duplicate,true);assert.deepEqual(await snapshot(),before);
});
test('all earnings in a multi-item payout are flagged while the other dancer remains unchanged',async()=>{
 payout=await seedPaidRecoveryDatabase(pg,{extraEarning:true});const before=await snapshot();const receipt=await flag(),after=await snapshot();
 assert.equal(receipt.earningCount,2);assert.equal(after.dancer_payout_batches[0].amount_cents,7000);
 assert.deepEqual(after.commission_events.find(e=>e.dancer_id===payoutId(2)),before.commission_events.find(e=>e.dancer_id===payoutId(2)));
 assert.equal(after.commission_events.filter(e=>e.payout_batch_id===payout.id&&e.recovery_required).length,2);assert.equal(audits(after).length,1);
});
test('queued local calls create one recovery audit; independent hosted sessions are not simulated',async()=>{
 const receipts=await Promise.all(Array.from({length:6},()=>flag()));assert.equal(receipts.filter(r=>!r.duplicate).length,1);assert.equal(audits(await snapshot()).length,1);
});
test('existing paid recovery flags without an audit gain the missing audit',async()=>{
 await pg.query("update commission_events set recovery_required=true,review_flag='paid_payout_reversed_by_provider' where payout_batch_id=$1",[payout.id]);
 assert.equal((await flag()).duplicate,false);assert.equal(audits(await snapshot()).length,1);assert.equal((await flag()).duplicate,true);
});
test('an audit without flags cannot falsely confirm recovery',async()=>{
 await pg.query("insert into financial_audit_events(actor_type,action,target_type,target_id,metadata) values('provider','paid_payout_recovery_required','payout',$1,jsonb_build_object('provider_reference_id',$2::text,'automatic_debit_attempted',false))",[payout.id,payout.reference]);
 assert.equal((await flag()).duplicate,false);assert.equal((await snapshot()).commission_events.find(e=>e.payout_batch_id===payout.id).recovery_required,true);
});
for(const existing of ['manual_fraud_review','paid_payout_reversed_by_provider',''])test('existing review reason is preserved: '+JSON.stringify(existing),async()=>{
 await pg.query('update commission_events set review_flag=$1 where payout_batch_id=$2',[existing,payout.id]);await flag();const row=(await snapshot()).commission_events.find(e=>e.payout_batch_id===payout.id);
 assert.equal(row.review_flag,existing);assert.equal(row.recovery_required,true);assert.equal((await flag()).duplicate,true);
});
for(const field of ['id','reference','reason'])for(const value of [null,''])test(field+' '+JSON.stringify(value)+' is rejected without writes',async()=>{
 const before=await snapshot();await assert.rejects(flag({[field]:value}),{code:field==='id'&&value===''?'22P02':'22023'});assert.deepEqual(await snapshot(),before);
});
for(const change of [{reference:'  tr_paid_recovery_synthetic'},{reference:'x'.repeat(256)},{reason:' '},{reason:'x'.repeat(501)}])test('malformed recovery input is rejected: '+Object.keys(change)[0]+'/'+Object.values(change)[0].length,async()=>{
 const before=await snapshot();await assert.rejects(flag(change),{code:'22023'});assert.deepEqual(await snapshot(),before);
});
test('an unknown payout fails closed',async()=>{const before=await snapshot();await assert.rejects(flag({id:payoutId(99)}),{code:'P0002'});assert.deepEqual(await snapshot(),before);});
test('another transfer reference cannot flag this payout',async()=>{const before=await snapshot();await assert.rejects(flag({reference:'tr_other_dancer'}),{code:'40001'});assert.deepEqual(await snapshot(),before);});
for(const status of ['requested','processing','failed','canceled'])test(status+' payout cannot be marked as a paid recovery',async()=>{
 await pg.query('update dancer_payout_batches set status=$1 where id=$2',[status,payout.id]);const before=await snapshot();await assert.rejects(flag(),{code:'40001'});assert.deepEqual(await snapshot(),before);
});
test('the Stripe-only operation cannot flag another payment provider',async()=>{
 await pg.query("update dancer_payout_batches set payment_provider='other' where id=$1",[payout.id]);const before=await snapshot();await assert.rejects(flag(),{code:'40001'});assert.deepEqual(await snapshot(),before);
});
test('a paid payout with no earnings cannot report successful recovery',async()=>{
 await pg.query("insert into dancer_payout_batches(id,dancer_id,status,currency,amount_cents,payment_provider,provider_reference_id) values($1,$2,'paid','usd',5000,'stripe','tr_empty_paid_batch')",[payoutId(99),payoutId(1)]);
 const before=await snapshot();await assert.rejects(flag({id:payoutId(99),reference:'tr_empty_paid_batch'}),{code:'40001'});assert.deepEqual(await snapshot(),before);
});
for(const [field,value]of [['status','available'],['dancer_id',payoutId(2)],['currency','eur'],['payment_provider','other']])test('inconsistent paid earning '+field+' requires reconciliation',async()=>{
 await pg.exec('reset role;alter table commission_events disable trigger commission_events_prepare_earning');await pg.query('update commission_events set '+field+'=$1 where payout_batch_id=$2',[value,payout.id]);await pg.exec('alter table commission_events enable trigger commission_events_prepare_earning;set role service_role');
 const before=await snapshot();await assert.rejects(flag(),{code:'40001'});assert.deepEqual(await snapshot(),before);
});
test('a mismatched payout total cannot be acknowledged',async()=>{await pg.query('update dancer_payout_batches set amount_cents=6000 where id=$1',[payout.id]);const before=await snapshot();await assert.rejects(flag(),{code:'40001'});assert.deepEqual(await snapshot(),before);});
test('a mismatched payout item amount cannot be acknowledged',async()=>{await pg.query('update dancer_payout_items set amount_cents=4000 where payout_batch_id=$1',[payout.id]);const before=await snapshot();await assert.rejects(flag(),{code:'40001'});assert.deepEqual(await snapshot(),before);});
test('missing payout items cannot be acknowledged',async()=>{await pg.exec('truncate dancer_payout_items');const before=await snapshot();await assert.rejects(flag(),{code:'40001'});assert.deepEqual(await snapshot(),before);});
test('an item referencing another dancer earning cannot be acknowledged',async()=>{await pg.query('update dancer_payout_items set commission_event_id=$1 where payout_batch_id=$2',[payoutId(22),payout.id]);const before=await snapshot();await assert.rejects(flag(),{code:'40001'});assert.deepEqual(await snapshot(),before);});

for(const [table,timing,operation,body,code]of [
 ['commission_events','after','update',"raise exception 'Synthetic recovery failure';",'P0001'],
 ['commission_events','before','update','return null;','40001'],
 ['commission_events','before','update','new.recovery_required:=false;return new;','40001'],
 ['commission_events','before','update',"new.metadata:='{\"unexpected\":true}'::jsonb;return new;",'40001'],
 ['financial_audit_events','after','insert',"raise exception 'Synthetic audit failure';",'P0001'],
 ['financial_audit_events','before','insert','return null;','40001'],
 ['financial_audit_events','before','insert',"new.reason:='Unexpected reason';return new;",'40001'],
 ['financial_audit_events','before','insert',"new.metadata:='{}'::jsonb;return new;",'40001'],
])test(table+' '+body+' rolls back flags and audit',async()=>{
 const before=await snapshot();await pg.exec('reset role;create or replace function public.synthetic_recovery_failure() returns trigger language plpgsql as $$begin '+body+'end$$;create trigger synthetic_failure '+timing+' '+operation+' on '+table+' for each row execute function public.synthetic_recovery_failure();set role service_role');
 await assert.rejects(flag(),{code});assert.deepEqual(await snapshot(),before);
 await pg.exec('reset role;drop trigger synthetic_failure on '+table+';set role service_role');assert.equal((await flag()).duplicate,false);assert.equal(audits(await snapshot()).length,1);
});
for(const role of ['anon','authenticated'])test(role+' cannot execute recovery or change private flags',async()=>{
 await pg.exec('set role '+role);await assert.rejects(flag(),{code:'42501'});await assert.rejects(pg.exec('update commission_events set recovery_required=false'),{code:'42501'});
});
test('the new migration is repeatable and preserves every existing function and row',async()=>{
 await flag();const before=await snapshot();await pg.exec('reset role');
 const sql="select proname,md5(pg_get_functiondef(oid)) hash,proacl from pg_proc where pronamespace='public'::regnamespace and oid<>$1::regprocedure order by proname,oid";
 const functions=(await pg.query(sql,[recoverySignature])).rows;await pg.exec(recoveryMigration);await pg.exec(recoveryMigration);assert.deepEqual(await snapshot(),before);assert.deepEqual((await pg.query(sql,[recoverySignature])).rows,functions);
 const row=(await pg.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid=$1::regprocedure",[recoverySignature])).rows[0];
 assert.equal(row.prosecdef,false);assert.ok(row.proconfig.includes('search_path=""'));assert.ok(row.proconfig.includes('lock_timeout=3s'));assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.equal(row.service,true);
});
