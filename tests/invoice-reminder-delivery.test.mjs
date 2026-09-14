import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {reminderDatabase,resetReminders,reminderHarness,invoiceRow,reminderCount,invoiceId,venueId,now} from './helpers/invoice-reminder-fixture.mjs';
let db;
before(async()=>{db=await reminderDatabase();});
after(async()=>db?.close());
beforeEach(async()=>resetReminders(db));
const claim=async()=> (await db.query("select public.claim_club_invoice_reminder_delivery($1,'overdue_0','in_synthetic') result",[invoiceId])).rows[0].result;
const complete=async c=>db.query("select public.complete_club_invoice_reminder_delivery($1,$2,'in_synthetic') result",[c.deliveryId,c.attemptToken]);
const expireLease=()=>db.exec("update club_invoice_reminder_deliveries set locked_until=clock_timestamp()-interval '1 second'");

test('overlapping workers share one durable reservation and dispatch one email',async()=>{
 const providerKeys=new Map(),a=reminderHarness(db,{providerKeys}),b=reminderHarness(db,{providerKeys});
 const results=await Promise.all([a.deliver(),b.deliver()]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(providerKeys.size,1);
 assert.equal([...a.calls,...b.calls].filter(c=>c==='email').length,1);
 assert.equal(await reminderCount(db),1);assert.equal((await invoiceRow(db)).reminder_count,1);
});

test('a lost claim response does not dispatch and its later retry reuses the reservation',async()=>{
 const h=reminderHarness(db,{afterClaimCommitError:new Error('Lost claim acknowledgment')});
 await assert.rejects(h.run(),/Lost claim/);assert.equal(h.calls.includes('send'),false);
 const first=(await db.query('select id from club_invoice_reminder_deliveries')).rows[0];
 assert.equal(await reminderHarness(db).run(),0);
 await expireLease();const retry=reminderHarness(db);assert.equal(await retry.run(),1);
 assert.deepEqual([...retry.providerKeys.keys()],['mydancr-reminder-'+first.id]);
});

test('a summary write failure rolls back the ledger and completion together',async()=>{
 await db.exec(`create function reject_reminder_summary() returns trigger language plpgsql as $$ begin
 if new.reminder_count > old.reminder_count then raise exception 'Synthetic summary failure'; end if; return new; end $$;
 create trigger reject_reminder_summary before update on club_invoices for each row execute function reject_reminder_summary();`);
 const h=reminderHarness(db);
 try{
  await assert.rejects(h.run(),/Synthetic summary failure/);
  assert.equal(await reminderCount(db),0);assert.equal((await invoiceRow(db)).reminder_count,0);
  assert.equal((await db.query('select status from club_invoice_reminder_deliveries')).rows[0].status,'dispatching');
 }finally{await db.exec('drop trigger reject_reminder_summary on club_invoices; drop function reject_reminder_summary()');}
 await expireLease();const retry=reminderHarness(db,{providerKeys:h.providerKeys});
 assert.equal(await retry.run(),1);assert.equal(retry.calls.includes('email'),false);
 assert.equal((await invoiceRow(db)).reminder_count,1);
});

test('a ledger write failure leaves a reusable reservation without a second email',async()=>{
 await db.exec(`create function reject_reminder_ledger() returns trigger language plpgsql as $$ begin raise exception 'Synthetic ledger failure'; end $$;
 create trigger reject_reminder_ledger before insert on club_invoice_reminders for each row execute function reject_reminder_ledger();`);
 const h=reminderHarness(db);
 try{await assert.rejects(h.run(),/Synthetic ledger failure/);assert.equal(await reminderCount(db),0);}
 finally{await db.exec('drop trigger reject_reminder_ledger on club_invoice_reminders; drop function reject_reminder_ledger()');}
 await expireLease();const retry=reminderHarness(db,{providerKeys:h.providerKeys});
 assert.equal(await retry.run(),1);assert.equal(retry.calls.includes('email'),false);
});

test('reclaim changes ownership but keeps the provider key and rejects stale completion',async()=>{
 const first=await claim();await expireLease();const second=await claim();
 assert.equal(second.deliveryId,first.deliveryId);assert.equal(second.idempotencyKey,first.idempotencyKey);
 assert.notEqual(second.attemptToken,first.attemptToken);
 await assert.rejects(complete(first),e=>e.code==='40001');assert.equal(await reminderCount(db),0);
 await complete(second);await complete(second);
 assert.equal(await reminderCount(db),1);assert.equal((await invoiceRow(db)).reminder_count,1);
});

test('an uncertain send beyond the provider retry window is held for review across weekly windows',async()=>{
 await claim();await db.exec("update club_invoice_reminder_deliveries set first_dispatch_at=clock_timestamp()-interval '24 hours',locked_until=clock_timestamp()-interval '1 hour'");
 const h=reminderHarness(db,{now:new Date(now.getTime()+7*86400000)});
 await assert.rejects(h.run(),/Review Stripe delivery/);assert.equal(h.calls.includes('send'),false);
 assert.match((await invoiceRow(db)).last_error,/Review Stripe delivery/);
 assert.equal((await db.query('select status from club_invoice_reminder_deliveries')).rows[0].status,'review_required');
 assert.equal(await reminderHarness(db,{now:new Date(now.getTime()+14*86400000)}).run(),0);
 assert.equal(await reminderCount(db),0);
});

test('an uncertain invoice cannot stop an independent reminder in the same batch',async()=>{
 await claim();await db.exec("update club_invoice_reminder_deliveries set first_dispatch_at=clock_timestamp()-interval '24 hours'");
 await db.query(`insert into club_invoices(id,venue_id,period_start,period_end,due_at,status,amount_due_cents,stripe_invoice_id,sequence)
 values('90000000-0000-4000-8000-000000000001',$1,'2026-08-01','2026-08-31','2026-09-09T12:00:00Z','open',1000,'in_independent',2)`,[venueId]);
 const h=reminderHarness(db);await assert.rejects(h.run(),/Review Stripe delivery/);
 assert.deepEqual([...h.providerKeys.values()],['in_independent']);assert.equal(await reminderCount(db),1);
});

test('250 invoices held for review cannot consume the next eligible candidate batch',async()=>{
 await db.query(`insert into club_invoices(id,venue_id,period_start,period_end,due_at,status,amount_due_cents,stripe_invoice_id,sequence)
 select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'2026-08-01','2026-08-31','2026-09-08T12:00:00Z','open',1000,'in_held_'||n,n+1 from generate_series(1,249)n`,[venueId]);
 await db.exec(`insert into club_invoice_reminder_deliveries(invoice_id,reminder_key,stripe_invoice_id,status,locked_until)
 select id,'overdue_0',stripe_invoice_id,'review_required',now() from club_invoices`);
 await db.query(`insert into club_invoices(id,venue_id,period_start,period_end,due_at,status,amount_due_cents,stripe_invoice_id,sequence)
 values('90000000-0000-4000-8000-000000000250',$1,'2026-08-01','2026-08-31','2026-09-09T12:00:00Z','open',1000,'in_eligible',251)`,[venueId]);
 const h=reminderHarness(db);assert.equal(await h.run(),1);
 assert.deepEqual([...h.providerKeys.values()],['in_eligible']);
});

for(const status of ['paid','void','uncollectible'])test('provider '+status+' state does not receive a reminder',async()=>{
 const h=reminderHarness(db,{providerStatus:status});assert.equal(await h.run(),0);assert.equal(h.calls.includes('claim'),false);
});
test('a terminal local invoice is rechecked under the claim lock',async()=>{
 const h=reminderHarness(db,{beforeClaim:()=>db.exec("update club_invoices set status='paid'")});
 assert.equal(await h.run(),0);assert.equal(h.calls.includes('send'),false);
});
for(const options of [{retrieveId:'in_wrong'},{sentId:'in_wrong'},{claimResponse:{status:'claimed'}},{completeResponse:{status:'sent'}}])test('unconfirmed delivery identities fail closed',async()=>{
 const h=reminderHarness(db,options);await assert.rejects(h.run(),/confirmed/);
 if(!options.completeResponse)assert.equal(await reminderCount(db),0);
 if(options.claimResponse||options.retrieveId)assert.equal(h.calls.includes('send'),false);
});

test('delivery storage and both mutation functions deny browser roles',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  for(const signature of ['claim_club_invoice_reminder_delivery(uuid,text,text)','complete_club_invoice_reminder_delivery(uuid,uuid,text)']){
   const row=(await db.query("select has_function_privilege($1,'public.'||$2,'execute') allowed",[role,signature])).rows[0];
   assert.equal(row.allowed,role==='service_role');
  }
  const row=(await db.query("select has_table_privilege($1,'public.club_invoice_reminder_deliveries','select,insert,update,delete') allowed",[role])).rows[0];
  assert.equal(row.allowed,role==='service_role');
 }
 await db.exec('grant select,update on club_invoices to service_role; grant select,insert on club_invoice_reminders to service_role; set role service_role');
 try{const c=await claim();assert.equal(c.status,'claimed');await complete(c);}
 finally{await db.exec('reset role');}
});
