import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {reminderDatabase,resetReminders,venueId} from './helpers/invoice-reminder-fixture.mjs';
let db;
before(async()=>{
 db=await reminderDatabase();
 // Only the joined reporting columns are needed from these unrelated tables.
 await db.exec(`alter table venues add column name text;
 create table dancer_profiles(id uuid primary key,stage_name text);
 create table commission_events(id uuid default gen_random_uuid(),venue_id uuid,dancer_id uuid,status text,amount_cents integer);
 create table deal_revenue_events(id uuid default gen_random_uuid(),status text,platform_commission_cents integer);
 create table nats_affiliate_accounts(id uuid default gen_random_uuid(),status text);
 create table nats_commission_exports(id uuid default gen_random_uuid(),status text,amount_cents integer);`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260914055315_complete_admin_finance_totals.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await resetReminders(db);
 await db.exec('truncate club_invoices cascade; truncate dancer_profiles,commission_events,deal_revenue_events,nats_affiliate_accounts,nats_commission_exports');
});
const totals=async()=> (await db.query('select public.get_admin_finance_totals() result')).rows[0].result;

test('empty financial history returns explicit zero totals and empty rankings',async()=>{
 const result=await totals();assert.equal(Object.keys(result.metrics).length,10);
 assert.ok(Object.values(result.metrics).every(value=>value==='0'));
 assert.deepEqual(result.earningsByVenue,[]);assert.deepEqual(result.earningsByDancer,[]);
});

test('all invoice statuses and partial payments contribute correctly beyond the 200-row list',async()=>{
 await db.query(`insert into club_invoices(venue_id,period_start,period_end,sequence,status,amount_due_cents,amount_paid_cents,due_at)
 select $1,'2026-08-01','2026-08-31',n,'paid',1000,1000,now()-interval '1 day' from generate_series(1,250)n`,[venueId]);
 await db.query(`insert into club_invoices(venue_id,period_start,period_end,sequence,status,amount_due_cents,amount_paid_cents,due_at) values
 ($1,'2026-08-01','2026-08-31',251,'open',1000,200,now()-interval '1 day'),
 ($1,'2026-08-01','2026-08-31',252,'overdue',2000,500,now()+interval '1 day'),
 ($1,'2026-08-01','2026-08-31',253,'open',3000,1000,now()+interval '1 day'),
 ($1,'2026-08-01','2026-08-31',254,'void',9000,0,now()-interval '1 day'),
 ($1,'2026-08-01','2026-08-31',255,'draft',9000,0,now()-interval '1 day')`,[venueId]);
 const m=(await totals()).metrics;
 assert.equal(m.paidClubRevenueCents,'250000');assert.equal(m.outstandingReceivablesCents,'4300');
 assert.equal(m.overdueReceivablesCents,'2300');assert.equal(m.openInvoiceCount,'3');assert.equal(m.overdueInvoiceCount,'2');
});

test('settled revenue and NATS aggregates include rows beyond both previous caps',async()=>{
 await db.exec(`insert into deal_revenue_events(status,platform_commission_cents) select 'settled',20 from generate_series(1,5501);
 insert into deal_revenue_events(status,platform_commission_cents) values('pending',999999),('reversed',999999),('failed',999999);
 insert into nats_affiliate_accounts(status) select 'requested' from generate_series(1,601);
 insert into nats_affiliate_accounts(status) values('active');
 insert into nats_commission_exports(status,amount_cents) select 'exported',30 from generate_series(1,602);
 insert into nats_commission_exports(status,amount_cents) select 'pending',30 from generate_series(1,603);
 insert into nats_commission_exports(status,amount_cents) values('waiting_for_affiliate',10),('processing',10),('reconciliation_required',10),('failed',9000);`);
 const m=(await totals()).metrics;
 assert.equal(m.myDancrNetRevenueCents,'110020');assert.equal(m.natsPendingAccountCount,'601');
 assert.equal(m.natsPendingExportCount,'605');assert.equal(m.natsReconciliationCount,'1');assert.equal(m.natsExportedCents,'18060');
});

test('rankings aggregate the full earning history before selecting ten groups',async()=>{
 await db.query("update venues set name='Long history' where id=$1",[venueId]);
 await db.query(`insert into dancer_profiles(id,stage_name) values($1,'Long history');
 `,[venueId]);
 await db.query(`insert into commission_events(venue_id,dancer_id,status,amount_cents) select $1,$1,'paid',2 from generate_series(1,5501)`,[venueId]);
 await db.exec(`insert into venues(id,name) select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Group '||lpad(n::text,2,'0') from generate_series(1,12)n;
 insert into dancer_profiles(id,stage_name) select id,name from venues where name like 'Group %';
 insert into commission_events(venue_id,dancer_id,status,amount_cents) select id,id,'available',100 from venues where name like 'Group %';
 insert into commission_events(venue_id,dancer_id,status,amount_cents) select id,id,'reversed',999999 from venues where name='Group 12';
 insert into commission_events(status,amount_cents) values('failed',999999);`);
 const result=await totals();
 for(const groups of [result.earningsByVenue,result.earningsByDancer]){
  assert.equal(groups.length,10);assert.deepEqual(groups[0],{name:'Long history',amountCents:'11002',count:'5501'});
  assert.deepEqual(groups.slice(1).map(g=>g.name),Array.from({length:9},(_,i)=>'Group 0'+(i+1)));
 }
});

test('the total function is callable by the service role and denied to browser roles',async()=>{
 await db.exec('grant select on club_invoices,venues,dancer_profiles,commission_events,deal_revenue_events,nats_affiliate_accounts,nats_commission_exports to service_role');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{if(role==='service_role')await totals();else await assert.rejects(totals(),e=>e.code==='42501');}
  finally{await db.exec('reset role');}
 }
});

function reportingHarness(result,{error=null,invoices=[]}={}){
 const exports={},calls=[];
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/dancr/finance-reporting.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,{exports,Error,require:name=>({
  './payout-provider':{getPayoutRuntimeConfig:()=>({enabledByEnvironment:false}),isPayoutProviderConfigured:()=>false},
  './payout-account-store':{},'./finance-earning-lifecycle':{},'./venue-access':{},'./nats':{getNatsRuntimeConfig:()=>({})}
 })[name]});
 const client={
  rpc(name){calls.push(name);return Promise.resolve(name==='get_admin_finance_totals'?{data:result,error}:{data:{},error:null});},
  from(table){assert.notEqual(table,'deal_revenue_events');const response={data:table==='club_invoices'?invoices:table==='payout_settings'?{}:[],error:null};
   const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return Promise.resolve(response);},single(){return Promise.resolve(response);}};return q;}
 };
 return {run:()=>exports.getAdminFinanceOverview(client),calls};
}

test('the admin response uses complete totals even when display lists are empty',async()=>{
 const result=await totals();result.metrics.myDancrNetRevenueCents='100001';result.metrics.openInvoiceCount='251';
 const h=reportingHarness(result),overview=await h.run();
 assert.equal(overview.metrics.myDancrNetRevenueCents,100001);assert.equal(overview.metrics.openInvoiceCount,251);
 assert.equal(overview.invoices.length,0);assert.equal(overview.earnings.length,0);
 assert.ok(h.calls.includes('get_admin_dancer_financial_summary'));
});

test('a reminder hold stays visible after provider reconciliation clears the transient error',async()=>{
 const h=reportingHarness(await totals(),{invoices:[{id:'held',last_error:null,club_invoice_reminder_deliveries:[{status:'review_required'}]},{id:'clear',last_error:null,club_invoice_reminder_deliveries:[]}]});
 const overview=await h.run();assert.match(overview.invoices[0].last_error,/Review Stripe delivery/);assert.equal(overview.invoices[1].last_error,null);
});

test('missing, malformed and unsafe totals fail instead of reporting misleading zeroes',async()=>{
 const fault=new Error('Synthetic totals timeout');await assert.rejects(reportingHarness(null,{error:fault}).run(),error=>error===fault);
 for(const invalid of [null,{}, {...await totals(),metrics:{}}, {...await totals(),earningsByVenue:null}])await assert.rejects(reportingHarness(invalid).run(),/could not be confirmed/);
 for(const value of ['9007199254740992',null,undefined,true,-1,1.5,'NaN']){
  const result=await totals();result.metrics.outstandingReceivablesCents=value;
  await assert.rejects(reportingHarness(result).run(),/could not be confirmed|integer range/);
 }
});
