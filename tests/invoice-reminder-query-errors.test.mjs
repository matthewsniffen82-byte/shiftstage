import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {reminderDatabase,resetReminders,reminderHarness,invoiceRow,reminderCount,invoiceId} from './helpers/invoice-reminder-fixture.mjs';
let db;
before(async()=>{db=await reminderDatabase();});
after(async()=>db?.close());
beforeEach(async()=>resetReminders(db));

for(const stage of ['list','lookup','overdue'])for(const code of ['57014','42501'])test(stage+' '+code+' stops before provider dispatch',async()=>{
 const fault={code,message:'Synthetic database rejection'},h=reminderHarness(db,{[stage+'Error']:fault});
 await assert.rejects(h.run(),error=>error===fault);
 assert.equal(h.calls.includes('retrieve'),false);assert.equal(h.calls.includes('send'),false);assert.equal(await reminderCount(db),0);
});
test('an unacknowledged overdue update stops before provider dispatch',async()=>{
 const h=reminderHarness(db,{overdueZero:true});await assert.rejects(h.run(),/Invoice.*changed|overdue.*confirmed/i);
 assert.equal(h.calls.includes('send'),false);assert.equal(h.calls.includes('retrieve'),false);
});
for(const status of ['paid','void','uncollectible'])test('an invoice concurrently becoming '+status+' is preserved without a reminder',async()=>{
 const h=reminderHarness(db,{beforeOverdue:()=>db.query('update club_invoices set status=$1 where id=$2',[status,invoiceId])});
 await assert.rejects(h.run(),/Invoice.*changed|overdue.*confirmed/i);
 assert.equal((await invoiceRow(db)).status,status);assert.equal(h.calls.includes('send'),false);assert.equal(await reminderCount(db),0);
});
for(const stage of ['retrieve','send','ledger'])test(stage+' failure is surfaced without a summary success',async()=>{
 const fault=new Error('Synthetic '+stage+' failure'),h=reminderHarness(db,{[stage+'Error']:fault});
 await assert.rejects(h.run(),error=>error===fault);
 assert.equal(h.calls.includes('summary'),false);assert.equal((await invoiceRow(db)).reminder_count,0);
});
for(const options of [{summaryError:{code:'57014'}},{summaryZero:true},{afterSummaryCommitError:{code:'08006'}}])test('an unconfirmed summary reports partial delivery and preserves its ledger on explicit retry',async()=>{
 const h=reminderHarness(db,options);
 await assert.rejects(h.run(),/Reminder was sent.*summary.*confirmed/);
 assert.equal(h.calls.filter(c=>c==='send').length,1);assert.equal(await reminderCount(db),1);
 assert.equal((await invoiceRow(db)).reminder_count,options.afterSummaryCommitError?1:0);
 const retry=reminderHarness(db);
 assert.equal(await retry.run(),0);assert.equal(retry.calls.includes('send'),false);assert.equal(await reminderCount(db),1);
});
test('a confirmed reminder saves its ledger and summary before returning the count',async()=>{
 const h=reminderHarness(db);assert.equal(await h.run(),1);
 assert.equal(await reminderCount(db),1);const row=await invoiceRow(db);
 assert.equal(row.status,'overdue');assert.equal(row.reminder_count,1);assert.ok(row.last_reminder_at);
 assert.ok(h.calls.indexOf('overdue')<h.calls.indexOf('retrieve'));
 assert.ok(h.calls.indexOf('ledger')<h.calls.indexOf('summary'));
});
test('a due-soon reminder keeps the open state and requires its summary acknowledgment',async()=>{
 await resetReminders(db,{due:'2026-09-12T12:00:00Z'});
 const h=reminderHarness(db);assert.equal(await h.run(),1);assert.equal(h.calls.includes('overdue'),false);
 assert.equal((await invoiceRow(db)).status,'open');assert.equal((await invoiceRow(db)).reminder_count,1);
});
test('future invoices and non-email collection methods do not send reminders',async()=>{
 await resetReminders(db,{due:'2026-10-12T12:00:00Z'});
 const future=reminderHarness(db);assert.equal(await future.run(),0);assert.equal(future.calls.includes('retrieve'),false);
 await resetReminders(db);
 const automatic=reminderHarness(db,{collectionMethod:'charge_automatically'});
 assert.equal(await automatic.run(),0);assert.equal(automatic.calls.includes('send'),false);assert.equal(await reminderCount(db),0);
});
test('the captured database constraint rejects a duplicate reminder without deleting history',async()=>{
 const h=reminderHarness(db);assert.equal(await h.run(),1);
 await assert.rejects(db.query("insert into club_invoice_reminders(invoice_id,reminder_key) values($1,'overdue_0')",[invoiceId]),error=>error.code==='23505');
 assert.equal(await reminderCount(db),1);
});
