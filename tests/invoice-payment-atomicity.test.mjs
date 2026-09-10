import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createInvoiceClaimDatabase,seedInvoiceClaimDatabase,claimInvoice,invoiceSnapshot,invoiceId} from './helpers/invoice-claim-database.mjs';
let db,id;
before(async()=>{db=await createInvoiceClaimDatabase();});
beforeEach(async()=>{await seedInvoiceClaimDatabase(db);await db.exec('reset role;drop trigger if exists synthetic_failure on public.agent_commission_events;set role service_role');id=await claimInvoice(db);});
after(async()=>db?.close());
const paidAt='2026-09-10T00:00:00Z';
const pay=(amount=1000,invoice=id,reference='synthetic-payment')=>db.query('select public.apply_club_invoice_payment($1,$2,$3,$4) receipt',[invoice,amount,reference,paidAt]);
test('confirmed invoice payment settles its revenue and makes its agent commission payable together',async()=>{
 const before=await invoiceSnapshot(db),receipt=(await pay()).rows[0].receipt,state=await invoiceSnapshot(db);
 assert.equal(receipt.status,'paid');assert.equal(receipt.amount_paid_cents,1000);assert.equal(state.club_invoices[0].status,'paid');
 assert.equal(state.deal_revenue_events.filter(r=>r.club_invoice_id===id&&r.status==='settled').length,2);
 assert.equal(state.agent_commission_events[0].status,'payable');assert.equal(state.agent_commission_events[0].payable_at,'2026-09-10T00:00:00+00:00');
 assert.deepEqual(state.deal_revenue_events.find(r=>r.id===invoiceId(13)),before.deal_revenue_events.find(r=>r.id===invoiceId(13)));
});
test('partial invoice payment does not release revenue or agent commissions',async()=>{
 const before=await invoiceSnapshot(db),receipt=(await pay(400)).rows[0].receipt,state=await invoiceSnapshot(db);
 assert.equal(receipt.status,'open');assert.equal(receipt.amount_paid_cents,400);
 assert.deepEqual(state.deal_revenue_events,before.deal_revenue_events);assert.deepEqual(state.agent_commission_events,before.agent_commission_events);
});
for(const table of ['club_invoices','deal_revenue_events','agent_commission_events'])test('payment failure updating '+table+' rolls back all settlement changes',async()=>{
 await db.exec("reset role;create or replace function public.synthetic_settlement_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic settlement failure';end$$;create trigger synthetic_failure before update on public."+table+" for each row execute function public.synthetic_settlement_failure();set role service_role");
 const before=await invoiceSnapshot(db);await assert.rejects(pay(),/Synthetic settlement failure/);assert.deepEqual(await invoiceSnapshot(db),before);
});
for(const status of ['void','uncollectible'])test(status+' invoice rejects payment without changing its revenue',async()=>{
 await db.query('update public.club_invoices set status=$1 where id=$2',[status,id]);const before=await invoiceSnapshot(db);
 await assert.rejects(pay(),e=>e.code==='22023');assert.deepEqual(await invoiceSnapshot(db),before);
});
test('missing invoice cannot settle unrelated revenue',async()=>{
 const before=await invoiceSnapshot(db);await assert.rejects(pay(1000,invoiceId(99)),e=>e.code==='P0002');assert.deepEqual(await invoiceSnapshot(db),before);
});
test('unconfirmed payment reference cannot mutate the ledger',async()=>{
 const before=await invoiceSnapshot(db);await assert.rejects(pay(1000,id,''),e=>e.code==='22023');assert.deepEqual(await invoiceSnapshot(db),before);
});
test('an older smaller payment cannot reduce the recorded settled amount',async()=>{
 await pay();const receipt=(await pay(400)).rows[0].receipt;assert.equal(receipt.status,'paid');assert.equal(receipt.amount_paid_cents,1000);
 assert.equal((await invoiceSnapshot(db)).club_invoices[0].amount_paid_cents,1000);
});
test('invoice payment does not reopen an already paid agent commission',async()=>{
 await db.exec("update public.agent_commission_events set status='paid'");const before=await invoiceSnapshot(db);await pay();
 assert.deepEqual((await invoiceSnapshot(db)).agent_commission_events,before.agent_commission_events);
});
test('settling one invoice leaves another invoice and its revenue unchanged',async()=>{
 const other=await claimInvoice(db,{ids:[invoiceId(13)]}),before=await invoiceSnapshot(db);await pay();const state=await invoiceSnapshot(db);
 assert.deepEqual(state.club_invoices.find(r=>r.id===other),before.club_invoices.find(r=>r.id===other));
 assert.deepEqual(state.deal_revenue_events.find(r=>r.club_invoice_id===other),before.deal_revenue_events.find(r=>r.club_invoice_id===other));
});
