import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createWebhookAttemptDatabase,seedWebhookAttemptDatabase,claimWebhookAttempt,webhookSnapshot,webhookSchema,webhookMigration,webhookSignature} from './helpers/payment-webhook-attempt-database.mjs';

let pg;
before(async()=>{pg=await createWebhookAttemptDatabase();});
beforeEach(async()=>seedWebhookAttemptDatabase(pg));
after(async()=>pg?.close());
const expire=()=>pg.exec("update public.payment_provider_webhook_events set processing_started_at=clock_timestamp()-interval '11 minutes'");
const finish=async(receipt,status='processed')=>(await pg.query("update public.payment_provider_webhook_events set processing_status=$1,processed_at=clock_timestamp() where id=$2 and payment_provider=$3 and provider_event_id=$4 and processing_status='processing' and attempt_count=$5 and processing_started_at=$6::timestamptz returning id",[status,receipt.id,receipt.paymentProvider,receipt.eventId,receipt.attemptCount,receipt.processingStartedAt])).rows;

test('the previous event-only completion can overwrite a reclaimed attempt',async()=>{
 await claimWebhookAttempt(pg);await expire();const current=await claimWebhookAttempt(pg);
 assert.equal(current.attemptCount,2);
 await pg.exec("update public.payment_provider_webhook_events set processing_status='processed' where payment_provider='stripe' and provider_event_id='evt_synthetic' and processing_status='processing'");
 assert.equal((await webhookSnapshot(pg))[0].processing_status,'processed');
});
test('a fresh claim returns the exact persisted ownership and no private metadata',async()=>{
 const receipt=await claimWebhookAttempt(pg),[row]=await webhookSnapshot(pg);
 assert.equal(receipt.claimed,true);assert.equal(receipt.status,'processing');assert.equal(receipt.id,row.id);
 assert.equal(receipt.attemptCount,row.attempt_count);assert.equal(receipt.processingStartedAt,row.processing_started_at);
 assert.deepEqual(Object.keys(receipt).sort(),['id','paymentProvider','eventId','eventType','objectId','claimed','status','attemptCount','processingStartedAt'].sort());
 assert.equal(row.metadata.constructor,Object);
});
test('an active duplicate does not acquire or extend the lease',async()=>{
 const first=await claimWebhookAttempt(pg),before=await webhookSnapshot(pg),second=await claimWebhookAttempt(pg);
 assert.equal(second.claimed,false);assert.equal(second.id,first.id);assert.equal(second.attemptCount,1);
 assert.equal(second.processingStartedAt,first.processingStartedAt);assert.deepEqual(await webhookSnapshot(pg),before);
});
test('a completed duplicate can be identified without another claim or write',async()=>{
 const first=await claimWebhookAttempt(pg);await finish(first);const before=await webhookSnapshot(pg),second=await claimWebhookAttempt(pg);
 assert.equal(second.claimed,false);assert.equal(second.status,'processed');assert.deepEqual(await webhookSnapshot(pg),before);
});
test('a failed attempt can be retried immediately with a new attempt number',async()=>{
 const first=await claimWebhookAttempt(pg);await finish(first,'failed');
 const second=await claimWebhookAttempt(pg);assert.equal(second.id,first.id);assert.equal(second.claimed,true);assert.equal(second.attemptCount,2);
 assert.equal((await webhookSnapshot(pg))[0].processed_at,null);
});
test('expired processing is reclaimed but the old receipt cannot finish or fail the new attempt',async()=>{
 const first=await claimWebhookAttempt(pg);await expire();const second=await claimWebhookAttempt(pg),before=await webhookSnapshot(pg);
 assert.equal(second.claimed,true);assert.equal(second.attemptCount,2);
 assert.deepEqual(await finish(first),[]);assert.deepEqual(await finish(first,'failed'),[]);assert.deepEqual(await webhookSnapshot(pg),before);
 assert.equal((await finish(second)).length,1);assert.equal((await webhookSnapshot(pg))[0].processing_status,'processed');
});
test('attempt number still fences a stale worker when timestamps are deliberately equal',async()=>{
 const first=await claimWebhookAttempt(pg);await expire();const second=await claimWebhookAttempt(pg);
 await pg.query('update public.payment_provider_webhook_events set processing_started_at=$1',[first.processingStartedAt]);
 assert.deepEqual(await finish(first),[]);assert.equal((await finish({...second,processingStartedAt:first.processingStartedAt})).length,1);
});
test('same attempt number with a different raw timestamp cannot finalize',async()=>{
 const first=await claimWebhookAttempt(pg);await pg.exec("update public.payment_provider_webhook_events set processing_started_at=processing_started_at+interval '1 microsecond'");
 assert.deepEqual(await finish(first),[]);
});
test('receipt preserves PostgreSQL microseconds and normalizes the response timezone',async()=>{
 await claimWebhookAttempt(pg);await pg.exec("set timezone='America/Los_Angeles';update public.payment_provider_webhook_events set processing_started_at='2099-01-01T00:00:00.123456Z'");
 const receipt=await claimWebhookAttempt(pg);assert.equal(receipt.processingStartedAt,'2099-01-01T00:00:00.123456+00:00');
 assert.equal((await pg.query('show timezone')).rows[0].TimeZone,'America/Los_Angeles');
});
for(const provider of ['stripe','adyen','other'])test(provider+' retains its supported claim behavior',async()=>{
 const receipt=await claimWebhookAttempt(pg,{provider});assert.equal(receipt.claimed,true);assert.equal(receipt.paymentProvider,provider);
});
for(const [field,value] of [['provider',null],['provider','unknown'],['provider','bitsafe'],['eventId',null],['eventId','   '],['eventType',null],['eventType','']])test('invalid '+field+' '+value+' does not create an event',async()=>{
 await assert.rejects(claimWebhookAttempt(pg,{[field]:value}),{code:'22023'});assert.deepEqual(await webhookSnapshot(pg),[]);
});
test('event identifiers retain existing whitespace normalization',async()=>{
 const receipt=await claimWebhookAttempt(pg,{eventId:' evt_synthetic ',eventType:' invoice.paid ',objectId:' in_synthetic '});
 assert.equal(receipt.eventId,'evt_synthetic');assert.equal(receipt.eventType,'invoice.paid');assert.equal(receipt.objectId,'in_synthetic');
});
test('empty object identifiers are consistently null',async()=>{
 const first=await claimWebhookAttempt(pg,{objectId:'  '}),second=await claimWebhookAttempt(pg,{objectId:null});
 assert.equal(first.objectId,null);assert.equal(second.claimed,false);
});
for(const options of [{eventType:'invoice.voided'},{objectId:'in_another'},{objectId:null}])test('changed signed identity '+JSON.stringify(options)+' rolls back a reclaim',async()=>{
 await claimWebhookAttempt(pg);await expire();const before=await webhookSnapshot(pg);
 await assert.rejects(claimWebhookAttempt(pg,options),{code:'40001'});assert.deepEqual(await webhookSnapshot(pg),before);
});
for(const operation of ['INSERT','UPDATE'])test('a '+operation+' failure rolls back the entire claim',async()=>{
 if(operation==='UPDATE'){await claimWebhookAttempt(pg);await expire();}
 const before=await webhookSnapshot(pg);
 await pg.exec("reset role;create or replace function public.synthetic_webhook_failure() returns trigger language plpgsql as $$begin raise exception using errcode='P0001',message='synthetic failure';end$$;create trigger synthetic_failure after "+operation+" on public.payment_provider_webhook_events for each row execute function public.synthetic_webhook_failure();set role service_role");
 await assert.rejects(claimWebhookAttempt(pg),{code:'P0001'});assert.deepEqual(await webhookSnapshot(pg),before);
});
test('a post-claim receipt mismatch rolls back the nested insert',async()=>{
 await pg.exec("reset role;create or replace function public.synthetic_webhook_failure() returns trigger language plpgsql as $$begin new.event_type:='synthetic.changed';return new;end$$;create trigger synthetic_failure before insert on public.payment_provider_webhook_events for each row execute function public.synthetic_webhook_failure();set role service_role");
 await assert.rejects(claimWebhookAttempt(pg),{code:'40001'});assert.deepEqual(await webhookSnapshot(pg),[]);
});
test('a missing nested claim result cannot be acknowledged',async()=>{
 await pg.exec("reset role;create or replace function public.claim_payment_provider_webhook(p_payment_provider text,p_provider_event_id text,p_event_type text,p_object_id text default null) returns boolean language sql as $$select null::boolean$$;set role service_role");
 await assert.rejects(claimWebhookAttempt(pg),{code:'40001'});assert.deepEqual(await webhookSnapshot(pg),[]);
});
test('queued duplicate calls return one owner; these are serialized local calls',async()=>{
 const receipts=await Promise.all(Array.from({length:8},()=>claimWebhookAttempt(pg)));
 assert.equal(receipts.filter(r=>r.claimed).length,1);assert.equal(new Set(receipts.map(r=>r.id)).size,1);assert.equal((await webhookSnapshot(pg)).length,1);
});
test('different providers and event IDs remain independent',async()=>{
 await claimWebhookAttempt(pg);await claimWebhookAttempt(pg,{provider:'adyen'});await claimWebhookAttempt(pg,{eventId:'evt_other'});
 assert.equal((await webhookSnapshot(pg)).length,3);
});
for(const role of ['anon','authenticated'])test(role+' cannot acquire attempts or read private ledger rows',async()=>{
 await claimWebhookAttempt(pg);await pg.exec('set role '+role);
 await assert.rejects(claimWebhookAttempt(pg),{code:'42501'});assert.deepEqual(await webhookSnapshot(pg),[]);
});
test('existing deletion protection and private metadata are preserved',async()=>{
 await claimWebhookAttempt(pg);await pg.exec("update public.payment_provider_webhook_events set metadata='{\"synthetic\":\"preserve\"}'");
 await assert.rejects(pg.exec('delete from public.payment_provider_webhook_events'),{code:'22023'});
 await expire();await claimWebhookAttempt(pg);assert.deepEqual((await webhookSnapshot(pg))[0].metadata,{synthetic:'preserve'});
});
test('migration is additive, repeatable and preserves the captured legacy function',async()=>{
 const before=await webhookSnapshot(pg);await pg.exec('reset role');await pg.exec(webhookMigration);await pg.exec(webhookMigration);
 assert.deepEqual(await webhookSnapshot(pg),before);
 const row=(await pg.query("select p.prosecdef,p.proconfig,has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p where oid=$1::regprocedure",[webhookSignature])).rows[0];
 assert.equal(row.prosecdef,false);assert.ok(row.proconfig.includes('search_path=""'));assert.ok(row.proconfig.includes('lock_timeout=3s'));assert.equal(row.service,true);assert.equal(row.anon,false);assert.equal(row.authenticated,false);
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.claim_payment_provider_webhook(text,text,text,text)'::regprocedure)) hash")).rows[0].hash,webhookSchema.existing_function.fingerprint);
});
