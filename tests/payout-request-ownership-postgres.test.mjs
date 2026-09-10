import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createPayoutRequestDatabase,seedPayoutRequestDatabase,requestPayout,payoutRequestSnapshot,payoutSchema,payoutMigration,payoutSignature,payoutTables,payoutId} from './helpers/payout-request-database.mjs';
let pg;
before(async()=>{pg=await createPayoutRequestDatabase({migrate:process.env.MYDANCR_PAYOUT_REQUEST_BASELINE!=='1'});});
beforeEach(async()=>seedPayoutRequestDatabase(pg));
after(async()=>pg?.close());
const snapshot=()=>payoutRequestSnapshot(pg);

test('the inspected historical fallback discloses another dancer payout on a key collision',async()=>{
 const legacy=await createPayoutRequestDatabase({migrate:false});try{
  await seedPayoutRequestDatabase(legacy);const original=await requestPayout(legacy),before=await payoutRequestSnapshot(legacy);
  assert.deepEqual(await requestPayout(legacy,{user:2}),{...original,duplicate:true});
  assert.deepEqual(await payoutRequestSnapshot(legacy),before);
 }finally{await legacy.close();}
});

for(const status of ['requested','processing','paid','failed','canceled'])test('a foreign '+status+' payout cannot be returned from the duplicate fallback',async()=>{
 const original=await requestPayout(pg);await pg.query('update dancer_payout_batches set status=$1 where id=$2',[status,original.id]);
 const before=await snapshot();await assert.rejects(requestPayout(pg,{user:2}),{code:'23505'});assert.deepEqual(await snapshot(),before);
});
test('whitespace normalization never defeats dancer ownership',async()=>{
 await requestPayout(pg);const before=await snapshot();await assert.rejects(requestPayout(pg,{user:2,key:'  synthetic-payout-request  '}),{code:'23505'});assert.deepEqual(await snapshot(),before);
});
test('an active payout error cannot return a different dancer payout with the submitted key',async()=>{
 await requestPayout(pg);await requestPayout(pg,{user:2,key:'synthetic-other-payout'});const before=await snapshot();
 await assert.rejects(requestPayout(pg,{user:2}),{code:'23505'});assert.deepEqual(await snapshot(),before);
});
for(const status of ['requested','processing','paid','failed','canceled'])test('same-owner '+status+' retries return only the original receipt',async()=>{
 const original=await requestPayout(pg);await pg.query('update dancer_payout_batches set status=$1 where id=$2',[status,original.id]);const before=await snapshot();
 assert.deepEqual(await requestPayout(pg,{key:' synthetic-payout-request '}),{...original,status,duplicate:true});assert.deepEqual(await snapshot(),before);
});
test('distinct dancers and keys reserve their own earnings and create exactly two audits',async()=>{
 const a=await requestPayout(pg),b=await requestPayout(pg,{user:2,key:'synthetic-second-request'}),state=await snapshot();
 assert.notEqual(a.id,b.id);assert.equal(a.amount_cents,5000);assert.equal(b.amount_cents,5000);
 assert.equal(state.financial_audit_events.length,2);assert.equal(state.dancer_payout_items.length,2);
 for(const [n,receipt]of [[1,a],[2,b]]){
  assert.equal(state.dancer_payout_batches.find(r=>r.id===receipt.id).dancer_id,payoutId(n));
  assert.equal(state.commission_events.find(r=>r.dancer_id===payoutId(n)).payout_batch_id,receipt.id);
 }
});
test('queued local retries produce a single payout and audit; this is not a hosted concurrent-session test',async()=>{
 const receipts=await Promise.all(Array.from({length:6},()=>requestPayout(pg)));assert.equal(new Set(receipts.map(r=>r.id)).size,1);
 assert.equal(receipts.filter(r=>!r.duplicate).length,1);assert.equal((await snapshot()).financial_audit_events.length,1);
});
for(const [table,operation]of [['dancer_payout_batches','INSERT'],['dancer_payout_items','INSERT'],['commission_events','UPDATE'],['financial_audit_events','INSERT']]){
 for(const code of ['P0001','23505'])test(table+' '+code+' failure rolls back the entire reservation',async()=>{
  const before=await snapshot();await pg.exec("reset role;create or replace function public.synthetic_request_failure() returns trigger language plpgsql as $$begin raise exception using errcode='"+code+"',message='synthetic failure';end$$;create trigger synthetic_failure after "+operation+' on '+table+' for each row execute function public.synthetic_request_failure();set role service_role');
  await assert.rejects(requestPayout(pg),{code});assert.deepEqual(await snapshot(),before);
 });
}
for(const user of [null,99])test('missing dancer '+user+' fails without a payout',async()=>{
 const before=await snapshot();await assert.rejects(requestPayout(pg,{user}),{code:'42501'});assert.deepEqual(await snapshot(),before);
});
for(const [options,code]of [[{key:null},'22023'],[{key:'short'},'22023'],[{provider:'unknown'},'22023'],[{provider:'bitsafe'},'22023']])test('invalid request remains rejected: '+JSON.stringify(options),async()=>{
 const before=await snapshot();await assert.rejects(requestPayout(pg,options),{code});assert.deepEqual(await snapshot(),before);
});
for(const field of ['onboarding_status','payout_eligibility','verification_status'])test(field+' still gates real cash-out',async()=>{
 const value={onboarding_status:'not_started',payout_eligibility:'ineligible',verification_status:'unverified'}[field];
 await pg.query('update dancer_payout_accounts set '+field+'=$1 where dancer_id=$2',[value,payoutId(1)]);const before=await snapshot();
 await assert.rejects(requestPayout(pg),{code:'22023'});assert.deepEqual(await snapshot(),before);
});
test('minimum and manual-mode restrictions survive',async()=>{
 await pg.exec('update payout_settings set minimum_payout_cents=6000');let before=await snapshot();await assert.rejects(requestPayout(pg),{code:'22023'});assert.deepEqual(await snapshot(),before);
 await pg.exec("update payout_settings set minimum_payout_cents=2000,payout_mode='scheduled'");before=await snapshot();await assert.rejects(requestPayout(pg),{code:'22023'});assert.deepEqual(await snapshot(),before);
});
for(const role of ['anon','authenticated'])test(role+' cannot execute the privileged payout function',async()=>{
 await pg.exec('set role '+role);await assert.rejects(requestPayout(pg),{code:'42501'});
});
test('forward migration is repeatable and preserves records, other functions and RPC privileges',async()=>{
 await requestPayout(pg);const before=await snapshot();await pg.exec('reset role');
 const metadataSql="select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid=$1::regprocedure";
 const metadata=(await pg.query(metadataSql,[payoutSignature])).rows;
 await pg.exec(payoutMigration);await pg.exec(payoutMigration);assert.deepEqual(await snapshot(),before);assert.deepEqual((await pg.query(metadataSql,[payoutSignature])).rows,metadata);
 for(const fn of payoutSchema.functions.filter(f=>f.name!=='request_dancer_payout'))assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+fn.signature])).rows[0].hash,fn.fingerprint);
 const grants=(await pg.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[payoutSignature])).rows[0];
 assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
 for(const table of payoutTables)assert.equal((await pg.query('select relrowsecurity rls from pg_class where oid=$1::regclass',['public.'+table])).rows[0].rls,true);
});
