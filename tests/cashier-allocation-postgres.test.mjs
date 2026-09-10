import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createCashierDatabase,seedCashierDatabase,issueCashier,cashierSnapshot,cashierId,cashierMigration,cashierSignature,cashierSchema,cashierTables} from './helpers/cashier-allocation-database.mjs';
let pg;
before(async()=>{pg=await createCashierDatabase({migrate:process.env.MYDANCR_CASHIER_ALLOCATION_BASELINE!=='1'});});
beforeEach(async()=>seedCashierDatabase(pg));
after(async()=>pg?.close());
const issue=options=>issueCashier(pg,options),snapshot=()=>cashierSnapshot(pg);
const allocations=async()=> (await pg.query("select * from agent_allocations_for_venue($1,(select fee_cents from venue_referral_fee_terms where id=$1),clock_timestamp()) order by sponsor_level",[cashierId(1)])).rows;
async function expectAllocation(receipt,expected){
 const s=await snapshot(),revenue=s.deal_revenue_events.find(r=>r.id===receipt.revenueEventId);
 const rows=s.agent_commission_events.filter(r=>r.deal_revenue_event_id===receipt.revenueEventId).sort((a,b)=>a.sponsor_level-b.sponsor_level);
 assert.deepEqual(rows.map(r=>Object.fromEntries(Object.keys(expected[0]||{}).map(k=>[k,r[k]]))),expected);
 const total=rows.reduce((n,r)=>n+r.amount_cents,0);
 assert.equal(total,receipt.agentCommissionCents);assert.equal(total,revenue.agent_commission_cents);
 assert.equal(revenue.gross_commission_cents,revenue.dancer_commission_cents+total+revenue.platform_commission_cents);
 assert.equal(receipt.status,'redeemed');assert.equal(s.qr_redemptions.find(r=>r.id===receipt.redemptionId).status,'redeemed');
 assert.equal(s.qr_redemption_events.filter(r=>r.qr_redemption_id===receipt.redemptionId&&r.event_type==='venue_confirmed').length,1);
 assert.equal(s.nfc_tap_events.filter(r=>r.audit.redemptionId===receipt.redemptionId).length,1);
 return {s,revenue,rows};
}
async function interleave(body){
 await pg.exec('reset role;create or replace function public.synthetic_cashier_change() returns trigger language plpgsql as $$begin if new.event_type=\'venue_confirmed\' then '+body+' end if;return new;end$$;create trigger synthetic_failure after insert on qr_redemption_events for each row execute function public.synthetic_cashier_change();set role service_role');
}
test('cashier preserves inspected commission rates, depth rules and balanced totals',async()=>{
 const expected=await allocations();assert.deepEqual(expected.map(r=>[r.sponsor_level,r.share_bps,r.amount_cents]),[[0,1500,1500],[1,300,300],[2,250,250],[3,200,200],[4,150,150]]);
 const {s}=await expectAllocation(await issue(),expected);assert.equal(s.commission_events.length,0);assert.equal(s.nats_agent_commission_exports.length,0);assert.equal(s.nfc_tags[0].tap_count,1);
});
for(const [name,prepare,change]of [
 ['direct agent suspended',null,`update sales_agents set status='suspended' where id='${cashierId(10)}';`],
 ['direct agent terminated',null,`update sales_agents set status='terminated' where id='${cashierId(10)}';`],
 ['sponsor suspended',null,`update sales_agents set status='suspended' where id='${cashierId(11)}';`],
 ['founder depth reduced',null,`update sales_agents set commission_depth_limit=3 where id='${cashierId(14)}';`],
 ['suspended agent reactivated',`update sales_agents set status='suspended' where id='${cashierId(10)}'`,`update sales_agents set status='active' where id='${cashierId(10)}';`],
 ['all agents suspended',null,"update sales_agents set status='suspended';"],
 ['inactive allocation becomes active',"update sales_agents set status='suspended'","update sales_agents set status='active';"],
 ['attribution replaced',null,`update venue_sales_attributions set superseded_at='2021-01-01' where id='${cashierId(20)}';insert into venue_sales_attributions(id,venue_id,signing_agent_id,effective_from,agreement_reference,created_by_admin_user_id) values('${cashierId(21)}','${cashierId(1)}','${cashierId(16)}','2022-01-01','Synthetic replacement','${cashierId(3)}');`],
 ['attribution expires',null,`update venue_sales_attributions set superseded_at='2021-01-01' where id='${cashierId(20)}';`],
])test('captured rows stay consistent when '+name+' between calculation and insertion',async()=>{
 if(prepare)await pg.exec(prepare);const expected=await allocations();await interleave(change);
 const {revenue}=await expectAllocation(await issue(),expected);assert.equal(revenue.venue_sales_attribution_id,cashierId(20));
});
test('a newly added attribution cannot appear only in later commission rows',async()=>{
 await seedCashierDatabase(pg,{attribution:false});await interleave(`insert into venue_sales_attributions(id,venue_id,signing_agent_id,effective_from,agreement_reference,created_by_admin_user_id) values('${cashierId(21)}','${cashierId(1)}','${cashierId(16)}','2022-01-01','Synthetic new attribution','${cashierId(3)}');`);
 const {revenue}=await expectAllocation(await issue(),[]);assert.equal(revenue.venue_sales_attribution_id,null);
});
test('missing attribution produces no commission rows and preserves the full platform amount',async()=>{
 await seedCashierDatabase(pg,{attribution:false});const {revenue}=await expectAllocation(await issue(),[]);assert.equal(revenue.venue_sales_attribution_id,null);assert.equal(revenue.platform_commission_cents,10000);
});
test('an attribution with no eligible recipients stays recorded without commission rows',async()=>{
 await pg.exec("update sales_agents set status='suspended'");const {revenue}=await expectAllocation(await issue(),[]);assert.equal(revenue.venue_sales_attribution_id,cashierId(20));
});
test('future attribution stays ineligible',async()=>{
 await pg.exec("update venue_sales_attributions set effective_from=clock_timestamp()+interval '1 day'");const {revenue}=await expectAllocation(await issue(),[]);assert.equal(revenue.venue_sales_attribution_id,null);
});
test('level five keeps its one percent rate and founder restriction',async()=>{
 await pg.query('update sales_agents set commission_depth_limit=3 where id=$1',[cashierId(14)]);await pg.query('update sales_agents set commission_depth_limit=5 where id=$1',[cashierId(15)]);
 const expected=await allocations();assert.deepEqual(expected.at(-1),{venue_sales_attribution_id:cashierId(20),signing_agent_id:cashierId(10),recipient_agent_id:cashierId(15),sponsor_level:5,share_bps:100,amount_cents:100});await expectAllocation(await issue(),expected);
});
for(const fee of [100,101,999,100000])test('rounding remains consistent at referral fee '+fee,async()=>{
 await seedCashierDatabase(pg,{fee});await expectAllocation(await issue(),await allocations());
});
test('unenrolled dancer attribution creates no dancer earning',async()=>{
 const receipt=await issue({source:'dancer_profile'});const {s}=await expectAllocation(receipt,await allocations());assert.equal(receipt.dancerCommissionEligible,false);assert.equal(s.commission_events.length,0);
});
test('enrolled dancer retains monthly 30/40/50 percent tiers alongside captured agent allocations',async()=>{
 await seedCashierDatabase(pg,{enrolled:true});const expected=await allocations();
 for(let n=1;n<=25;n++){
  const receipt=await issue({number:100+n,source:'dancer_profile'});await expectAllocation(receipt,expected);
  assert.equal(receipt.successfulRedemptionNumber,n);assert.equal(receipt.dancerShareBps,n>=25?5000:n>=10?4000:3000);assert.equal(receipt.dancerCommissionCents,receipt.dancerShareBps);
 }
 const s=await snapshot();assert.equal(s.commission_events.length,25);assert.equal(s.dancer_earning_status_history.length,25);assert.ok(s.commission_events.every(r=>r.status==='pending'));assert.equal(s.nats_commission_exports.length,0);
});
test('duplicate token cannot create another event, allocation or tap',async()=>{
 await issue();const before=await snapshot();await assert.rejects(issue(),{code:'23505'});assert.deepEqual(await snapshot(),before);
});
test('another token for the same customer within 24 hours is rejected atomically',async()=>{
 await issue({customer:2});const before=await snapshot();await assert.rejects(issue({number:31,customer:2}),{code:'23505'});assert.deepEqual(await snapshot(),before);
});
for(const [name,prepare,options,code]of [
 ['disabled cashier',"update nfc_tags set status='disabled'",{},'42501'],
 ['dressing room tag',"update nfc_tags set tag_type='dressing_room'",{},'42501'],
 ['inactive venue',"update venues set is_active=false",{},'42501'],
 ['inactive account',"update app_users set account_state='disabled' where role='venue'",{},'42501'],
 ['inactive deal',"update club_deals set is_active=false",{},'22023'],
 ['expired fee agreement',"update venue_referral_fee_terms set effective_until='2021-01-01'",{},'22023'],
 ['wrong venue',null,{venue:999},'23503'],
])test(name+' remains rejected without partial records',async()=>{
 if(prepare)await pg.exec(prepare);const before=await snapshot();await assert.rejects(issue(options),{code});assert.deepEqual(await snapshot(),before);
});
for(const table of ['qr_redemption_events','deal_revenue_events','agent_commission_events','commission_events','nfc_tap_events'])test(table+' failure rolls back redemption, commissions, history and tap',async()=>{
 await seedCashierDatabase(pg,{enrolled:true});const before=await snapshot();await pg.exec('reset role;create or replace function synthetic_cashier_fail() returns trigger language plpgsql as $$begin raise exception \'Synthetic cashier failure\';end$$;create trigger synthetic_failure after insert on '+table+' for each row execute function synthetic_cashier_fail();set role service_role');
 await assert.rejects(issue({source:'dancer_profile'}),{code:'P0001'});assert.deepEqual(await snapshot(),before);
});
for(const role of ['anon','authenticated'])test(role+' cannot call the privileged cashier functions',async()=>{
 const before=await snapshot();await pg.exec('set role '+role);await assert.rejects(issue(),{code:'42501'});await assert.rejects(pg.query('select public.confirm_deal_redemption_from_nfc($1,$2,$3)', ['synthetic',cashierId(1),cashierId(30)]),{code:'42501'});await pg.exec('set role service_role');assert.deepEqual(await snapshot(),before);
});
test('migration changes one function and preserves data, schema and execution access when reapplied',async()=>{
 await issue();const before=await snapshot();await pg.exec('reset role');
 const sql="select proname,md5(pg_get_functiondef(oid)) hash,proacl from pg_proc where pronamespace='public'::regnamespace and oid<>$1::regprocedure order by proname,oid";
 const functions=(await pg.query(sql,[cashierSignature])).rows;
 const schemaSQL="select c.relname,c.relrowsecurity,c.relacl,pg_get_constraintdef(k.oid) definition from pg_class c join pg_constraint k on k.conrelid=c.oid where c.relnamespace='public'::regnamespace and k.contype<>'n' order by c.relname,k.conname";
 const schema=(await pg.query(schemaSQL)).rows;await pg.exec(cashierMigration());await pg.exec(cashierMigration());assert.deepEqual(await snapshot(),before);assert.deepEqual((await pg.query(sql,[cashierSignature])).rows,functions);assert.deepEqual((await pg.query(schemaSQL)).rows,schema);
 const access=(await pg.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid=$1::regprocedure",[cashierSignature])).rows[0];
 assert.equal(access.prosecdef,true);assert.deepEqual(access.proconfig,['search_path=public, pg_temp']);assert.equal(access.anon,false);assert.equal(access.authenticated,false);assert.equal(access.service,true);
});
test('fixture retains all sixteen target tables and inspected constraint/index/trigger counts',async()=>{
 const params=[cashierTables];
 assert.equal((await pg.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name=any($1)",params)).rows[0].n,cashierSchema.columns.length);
 assert.equal((await pg.query("select count(*)::int n from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relnamespace='public'::regnamespace and t.relname=any($1) and c.contype<>'n'",params)).rows[0].n,cashierSchema.constraints.length);
 assert.equal((await pg.query("select count(*)::int n from pg_indexes where schemaname='public' and tablename=any($1)",params)).rows[0].n,cashierSchema.indexes.length);
 assert.equal((await pg.query("select count(*)::int n from pg_trigger tr join pg_class t on t.oid=tr.tgrelid where not tr.tgisinternal and t.relname=any($1)",params)).rows[0].n,cashierSchema.triggers.length);
});
