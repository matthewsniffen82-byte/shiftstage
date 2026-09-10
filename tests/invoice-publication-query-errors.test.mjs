import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {reminderDatabase,resetReminders,invoiceRow,invoiceId} from './helpers/invoice-reminder-fixture.mjs';
import {publicationHarness,publicationProvider,expectedLine,publicationAutomation} from './helpers/invoice-publication-fixture.mjs';
let db;
before(async()=>{db=await reminderDatabase();});
after(async()=>db?.close());
beforeEach(async()=>{await resetReminders(db,{status:'draft'});await db.query('update club_invoices set stripe_invoice_id=null where id=$1',[invoiceId]);});
const kinds=h=>h.calls.map(c=>c.kind);

test('a new invoice confirms its provider reference and line before publishing',async()=>{
 const h=publicationHarness(db),result=await h.run();
 assert.equal(result.opened,1);assert.equal(result.errors.length,0);
 assert.equal((await invoiceRow(db)).stripe_invoice_id,'in_synthetic');
 assert.ok(kinds(h).indexOf('reference')<kinds(h).indexOf('createItem'));
 assert.ok(kinds(h).indexOf('lines')<kinds(h).indexOf('finalize'));
 assert.equal(h.provider.lines.length,1);
});
for(const options of [{referenceError:{code:'57014'}},{referenceZero:true}])test('an unconfirmed provider reference stops before item creation or dispatch',async()=>{
 const h=publicationHarness(db,options),result=await h.run();
 assert.equal(result.opened,0);assert.equal(result.errors.length,1);
 for(const kind of ['createItem','finalize','send','sync'])assert.equal(kinds(h).includes(kind),false);
});
test('an uncertain committed reference is recovered on explicit retry before finalization',async()=>{
 const provider=publicationProvider(),first=publicationHarness(db,{provider,afterReferenceCommitError:{code:'08006'}});
 const result=await first.run();assert.equal(result.opened,0);assert.equal(result.errors.length,1);
 assert.equal((await invoiceRow(db)).stripe_invoice_id,'in_synthetic');assert.equal(provider.lines.length,0);
 const retry=publicationHarness(db,{provider});assert.equal((await retry.run()).opened,1);
 assert.equal(kinds(retry).includes('createInvoice'),false);assert.equal(provider.lines.length,1);
 assert.ok(kinds(retry).indexOf('createItem')<kinds(retry).indexOf('finalize'));
});
test('an uncertain committed item is reused on explicit retry without another item request',async()=>{
 const provider=publicationProvider(),first=publicationHarness(db,{provider,afterItemCommitError:new Error('Synthetic lost item response')});
 assert.equal((await first.run()).opened,0);assert.equal(provider.lines.length,1);assert.equal(kinds(first).includes('finalize'),false);
 const retry=publicationHarness(db,{provider});assert.equal((await retry.run()).opened,1);
 assert.equal(kinds(retry).includes('createItem'),false);assert.equal(provider.lines.length,1);
});
test('an existing matching invoice item is preserved when the old idempotency key may have expired',async()=>{
 await db.query('update club_invoices set stripe_invoice_id=$1 where id=$2',['in_synthetic',invoiceId]);
 const h=publicationHarness(db,{provider:publicationProvider({lines:[expectedLine()]})});
 assert.equal((await h.run()).opened,1);assert.equal(kinds(h).includes('createItem'),false);
});
for(const line of [{...expectedLine(),amount:2000},{...expectedLine(),currency:'eur'},{...expectedLine(),metadata:{}},[expectedLine(),expectedLine()]])test('unexpected existing items are not changed or finalized',async()=>{
 await db.query('update club_invoices set stripe_invoice_id=$1 where id=$2',['in_synthetic',invoiceId]);
 const lines=Array.isArray(line)?line:[line],provider=publicationProvider({lines}),h=publicationHarness(db,{provider});
 const result=await h.run();assert.equal(result.opened,0);assert.equal(result.errors.length,1);
 assert.equal(kinds(h).includes('createItem'),false);assert.equal(kinds(h).includes('finalize'),false);assert.deepEqual(provider.lines,lines);
});
for(const options of [{linesError:{status:503}},{lineResponse:{data:[],has_more:true}},{lineResponse:null}])test('uncertain line reads cannot create or finalize items',async()=>{
 const h=publicationHarness(db,options);assert.equal((await h.run()).opened,0);
 assert.equal(kinds(h).includes('createItem'),false);assert.equal(kinds(h).includes('finalize'),false);
});
for(const provider of [publicationProvider({customer:'cus_other'}),publicationProvider({metadata:{mydancr_invoice_id:'other'}})])test('a mismatched provider invoice is not published',async()=>{
 await db.query('update club_invoices set stripe_invoice_id=$1 where id=$2',['in_synthetic',invoiceId]);
 const h=publicationHarness(db,{provider}),result=await h.run();assert.equal(result.opened,0);assert.equal(result.errors.length,1);
 assert.equal(kinds(h).includes('createItem'),false);assert.equal(kinds(h).includes('send'),false);
});
for(const options of [{syncError:{code:'08006'}},{syncNull:true}])test('unconfirmed reconciliation is reported instead of counted as opened',async()=>{
 const h=publicationHarness(db,options),result=await h.run();
 assert.equal(result.opened,0);assert.equal(result.errors.length,1);
});
for(const status of ['paid','void','uncollectible'])test('failure persistence preserves a concurrently '+status+' invoice',async()=>{
 const h=publicationHarness(db,{linesError:{status:503},beforeFailure:()=>db.query('update club_invoices set status=$1 where id=$2',[status,invoiceId])});
 assert.equal((await h.run()).errors.length,1);assert.equal((await invoiceRow(db)).status,status);
});
test('failure-state persistence errors are themselves reported safely',async()=>{
 const h=publicationHarness(db,{linesError:{message:'synthetic secret details'},failureError:{code:'08006',message:'synthetic private connection'}});
 const result=await h.run();assert.equal(result.opened,0);assert.equal(result.errors.length,1);
 assert.doesNotMatch(result.errors.join(' '),/synthetic secret|private connection/);
});
test('publication counts and failures reach the existing automation response together',async()=>{
 const result=await publicationAutomation({opened:2,errors:['One invoice needs review.']});
 assert.equal(result.invoicesOpened,2);assert.deepEqual(Array.from(result.errors),['One invoice needs review.']);
});
for(const status of ['void','uncollectible'])test('an existing '+status+' provider invoice is reconciled without counting it as opened',async()=>{
 await db.query('update club_invoices set stripe_invoice_id=$1 where id=$2',['in_synthetic',invoiceId]);
 const h=publicationHarness(db,{provider:publicationProvider({status})}),result=await h.run();
 assert.equal(result.opened,0);assert.equal(result.errors.length,0);assert.equal((await invoiceRow(db)).status,status);
 assert.equal(kinds(h).includes('createItem'),false);assert.equal(kinds(h).includes('finalize'),false);assert.equal(kinds(h).includes('send'),false);
});
test('a concurrently paid invoice rejects the provider-reference transition before side effects',async()=>{
 const h=publicationHarness(db,{beforeReference:()=>db.query("update club_invoices set status='paid' where id=$1",[invoiceId])});
 assert.equal((await h.run()).errors.length,1);assert.equal((await invoiceRow(db)).status,'paid');
 assert.equal(kinds(h).includes('createItem'),false);assert.equal(kinds(h).includes('finalize'),false);
});
test('a concurrently linked different provider invoice is not overwritten',async()=>{
 const h=publicationHarness(db,{beforeReference:()=>db.query("update club_invoices set stripe_invoice_id='in_other' where id=$1",[invoiceId])});
 assert.equal((await h.run()).errors.length,1);assert.equal((await invoiceRow(db)).stripe_invoice_id,'in_other');
 assert.equal(kinds(h).includes('createItem'),false);assert.equal(kinds(h).includes('finalize'),false);
});
