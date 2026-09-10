import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createInvoiceClaimDatabase,seedInvoiceClaimDatabase,claimInvoice,invoiceSnapshot,invoiceId,invoiceSchema,invoiceSignature} from './helpers/invoice-claim-database.mjs';
let db;
before(async()=>{db=await createInvoiceClaimDatabase({migrate:process.env.INVOICE_CLAIM_BASELINE!=='1'});});
beforeEach(async()=>seedInvoiceClaimDatabase(db));
after(async()=>db?.close());
async function inject(table,event,body){
 await db.exec('reset role;create or replace function public.synthetic_invoice_failure() returns trigger language plpgsql as $$begin '+body+' end$$;create trigger synthetic_failure before '+event+' on public.'+table+' for each row execute function public.synthetic_invoice_failure();set role service_role');
}
async function unchangedFailure(options,code){
 const before=await invoiceSnapshot(db);await assert.rejects(claimInvoice(db,options),error=>!code||error.code===code);assert.deepEqual(await invoiceSnapshot(db),before);
}
test('one invoice contains exactly the selected revenue, amounts and currency',async()=>{
 const before=await invoiceSnapshot(db),id=await claimInvoice(db),state=await invoiceSnapshot(db);
 assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(state.club_invoices.length,1);assert.equal(state.club_invoices[0].amount_due_cents,1000);assert.equal(state.club_invoices[0].currency,'usd');
 assert.equal(state.club_invoice_items.length,2);assert.ok(state.club_invoice_items.every(r=>r.invoice_id===id&&r.amount_cents===500));
 assert.equal(state.deal_revenue_events.filter(r=>r.club_invoice_id===id).length,2);
 assert.deepEqual(state.deal_revenue_events.find(r=>r.id===invoiceId(13)),before.deal_revenue_events.find(r=>r.id===invoiceId(13)));
 assert.deepEqual(state.agent_commission_events,before.agent_commission_events);
});
test('a single non-USD group keeps its own currency rather than billing USD',async()=>{
 await db.exec("update public.deal_revenue_events set currency='eur'");
 const id=await claimInvoice(db);assert.equal((await invoiceSnapshot(db)).club_invoices.find(r=>r.id===id).currency,'eur');
});
test('mixed currencies cannot be merged into a single invoice',async()=>{
 await db.query("update public.deal_revenue_events set currency='eur' where id=$1",[invoiceId(11)]);await unchangedFailure({},'22023');
});
for(const [label,options] of [
 ['missing revenue',{ids:[invoiceId(99)]}],['duplicate IDs',{ids:[invoiceId(11),invoiceId(11)]}],
 ['empty IDs',{ids:[]}],['null IDs',{ids:null}],['null element',{ids:[null]}],
 ['unknown venue',{venue:invoiceId(99)}],['null venue',{venue:null}],
 ['wrong venue',{venue:invoiceId(2)}],['missing period start',{start:null}],
 ['missing period end',{end:null}],['reversed period',{end:'2026-07-31'}],['missing due date',{due:null}]
])test(label+' fails without changing financial records',async()=>unchangedFailure(options));
for(const status of ['payable','settled','refunded','voided'])test(status+' revenue cannot be invoiced',async()=>{
 await db.query('update public.deal_revenue_events set status=$1 where id=$2',[status,invoiceId(11)]);await unchangedFailure({},'22023');
});
test('zero-value revenue cannot produce a payable invoice',async()=>{
 await db.exec('update public.deal_revenue_events set gross_commission_cents=0,platform_commission_cents=0');await unchangedFailure({});
});
test('overflowing invoice total fails with no partial item or assignment',async()=>{
 await db.exec('update public.deal_revenue_events set gross_commission_cents=2147483647,platform_commission_cents=2147483647');await unchangedFailure({});
});
test('a repeated snapshot cannot create another invoice for the same revenue',async()=>{
 await claimInvoice(db);await unchangedFailure({},'22023');
});
test('another uninvoiced group gets the next sequence without changing the first invoice',async()=>{
 const first=await claimInvoice(db,{ids:[invoiceId(11)]}),before=await invoiceSnapshot(db);
 const second=await claimInvoice(db,{ids:[invoiceId(12)]}),state=await invoiceSnapshot(db);
 assert.equal(state.club_invoices.find(r=>r.id===second).sequence,2);
 assert.deepEqual(state.club_invoices.find(r=>r.id===first),before.club_invoices[0]);
});
test('queued overlapping claims leave only one invoice and one set of items',async()=>{
 const results=await Promise.allSettled([claimInvoice(db),claimInvoice(db)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const state=await invoiceSnapshot(db);assert.equal(state.club_invoices.length,1);assert.equal(state.club_invoice_items.length,2);
});
test('database uniqueness also rejects bypassing the invoice function',async()=>{
 const first=await claimInvoice(db,{ids:[invoiceId(11)]}),second=await claimInvoice(db,{ids:[invoiceId(12)]}),before=await invoiceSnapshot(db);
 await assert.rejects(db.query('insert into public.club_invoice_items(invoice_id,revenue_event_id,amount_cents) values($1,$2,500)',[second,invoiceId(11)]),e=>e.code==='23505');
 assert.deepEqual(await invoiceSnapshot(db),before);assert.notEqual(first,second);
});
test('voided invoice history cannot be silently billed again after a link is cleared',async()=>{
 const id=await claimInvoice(db,{ids:[invoiceId(11)]});
 await db.query("update public.club_invoices set status='void' where id=$1",[id]);await db.query('update public.deal_revenue_events set club_invoice_id=null where id=$1',[invoiceId(11)]);
 await unchangedFailure({ids:[invoiceId(11)]},'22023');
});
for(const [table,event] of [['club_invoices','insert'],['club_invoice_items','insert'],['deal_revenue_events','update']]){
 test('failure writing '+table+' rolls back the complete invoice',async()=>{
  await inject(table,event,"raise exception 'Synthetic failure';");await unchangedFailure({});
 });
 test('suppressed '+table+' write cannot return success',async()=>{
  await inject(table,event,'return null;');await unchangedFailure({});
 });
}
for(const [field,value]of [['amount_due_cents','999'],['currency',"'eur'"],['status',"'open'"],['period_start',"'2026-07-01'"],['sequence','7']])test('changed invoice '+field+' is caught before commit',async()=>{
 await inject('club_invoices','insert','new.'+field+' := '+value+';return new;');await unchangedFailure({},'40001');
});
for(const body of [
 "new.currency := 'eur';return new;",
 'new.gross_commission_cents := 600;new.platform_commission_cents := 600;return new;',
 "new.venue_id := '"+invoiceId(2)+"';return new;",
 "new.status := 'refunded';return new;"
])test('changed revenue assignment cannot commit mismatched items: '+body,async()=>{
 await inject('deal_revenue_events','update',body);await unchangedFailure({},'40001');
});
test('changed item amount cannot commit a different invoice total',async()=>{
 await inject('club_invoice_items','insert','new.amount_cents := 600;return new;');await unchangedFailure({},'40001');
});
test('an unexpected extra invoice item cannot escape the total check',async()=>{
 await inject('club_invoice_items','insert',"if pg_trigger_depth()=1 and new.revenue_event_id='"+invoiceId(11)+"' then insert into public.club_invoice_items(invoice_id,revenue_event_id,amount_cents) values(new.invoice_id,'"+invoiceId(13)+"',500);end if;return new;");
 await unchangedFailure({},'40001');
});
test('invoice payment dependency remains byte-for-byte unchanged',async()=>{
 const fn=invoiceSchema.functions.find(r=>r.name==='apply_club_invoice_payment');
 assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+fn.signature])).rows[0].hash,fn.fingerprint);
});
test('exact role boundary and target RLS remain in place',async()=>{
 await db.exec('reset role');const result=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service,proconfig from pg_proc where oid=$1::regprocedure",[invoiceSignature])).rows[0];
 assert.equal(result.anon,false);assert.equal(result.authenticated,false);assert.equal(result.service,true);assert.ok(result.proconfig.includes('search_path=""'));assert.ok(result.proconfig.includes('lock_timeout=3s'));
 assert.equal((await db.query("select count(*)::int n from pg_class where relname in ('club_invoices','club_invoice_items','deal_revenue_events') and relrowsecurity")).rows[0].n,3);
});
for(const role of ['anon','authenticated'])test(role+' cannot call the invoice function',async()=>{
 await db.exec('reset role;set role '+role);await assert.rejects(claimInvoice(db),e=>e.code==='42501');
});
