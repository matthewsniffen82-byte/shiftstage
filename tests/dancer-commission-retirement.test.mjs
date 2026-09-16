import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import { createCashierDatabase, seedCashierDatabase, issueCashier, cashierSnapshot, cashierId } from './helpers/cashier-allocation-database.mjs';

const migration = await readFile(new URL('../supabase/migrations/20260915210000_retire_dancer_commissions.sql', import.meta.url), 'utf8');
let pg;
let historical;
before(async () => {
  pg = await createCashierDatabase();
  await seedCashierDatabase(pg, { enrolled: true });
  await issueCashier(pg, { number: 40, source: 'dancer_profile' });
  await pg.exec("update commission_events set status='available'");
  historical = await cashierSnapshot(pg);
  assert.equal(historical.commission_events.length, 1);
  assert.equal(historical.nats_commission_exports.length, 1);
  await pg.exec('reset role');
  for (const [file, name] of [
    ['202609080001_prospective_nats_dancer_commissions.sql', 'claim_nats_commission_exports'],
    ['202608220003_agent_commission_nats_settlement.sql', 'claim_nats_agent_commission_exports'],
  ]) {
    const source = await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
    const start = source.indexOf('create or replace function public.' + name + '(');
    assert.ok(start >= 0);
    await pg.exec(source.slice(start, source.indexOf('$$;', start) + 3));
    await pg.exec(`revoke all on function ${name}(integer) from public,anon,authenticated;grant execute on function ${name}(integer) to service_role`);
  }
  await pg.exec(migration);
  await pg.exec('set role service_role');
});
after(async () => pg?.close());

test('retirement leaves every existing financial and attribution record unchanged', async () => {
  assert.deepEqual(await cashierSnapshot(pg), historical);
});

test('an already enrolled dancer receives no new commissions while referrals and agent allocations continue', async () => {
  for (let number = 50; number < 77; number++) {
    const receipt = await issueCashier(pg, { number, source: 'dancer_profile' });
    assert.equal(receipt.status, 'redeemed');
    assert.equal(receipt.dancerCommissionEligible, false);
    assert.equal(receipt.dancerCommissionCents, 0);
    assert.equal(receipt.dancerShareBps, 0);
    assert.equal(receipt.successfulRedemptionNumber, null);
    assert.equal(receipt.grossCommissionCents, 10000);
    assert.equal(receipt.agentCommissionCents, 2400);
    assert.equal(receipt.platformCommissionCents, 7600);
    const { rows: [revenue] } = await pg.query('select * from deal_revenue_events where id=$1', [receipt.revenueEventId]);
    assert.equal(revenue.dancer_id, cashierId(2));
    assert.equal(revenue.dancer_nats_activated_at, null);
    assert.equal(revenue.audit.dancer_commission_reason, 'program_retired');
    assert.equal(revenue.policy_version, 'dancer-commissions-retired+sales-agent-v3');
    const { rows: [agents] } = await pg.query('select sum(amount_cents)::int total from agent_commission_events where deal_revenue_event_id=$1', [receipt.revenueEventId]);
    assert.equal(agents.total, receipt.agentCommissionCents);
  }
  const current = await cashierSnapshot(pg);
  for (const table of ['commission_events', 'nats_commission_exports', 'nats_affiliate_accounts', 'dancer_earning_status_history']) {
    assert.deepEqual(current[table], historical[table], table);
  }
});

test('direct venue redemptions retain their fee and sales-agent split', async () => {
  const receipt = await issueCashier(pg, { number: 80 });
  assert.equal(receipt.dancerCommissionCents, 0);
  assert.equal(receipt.platformCommissionCents, 7600);
  assert.equal(receipt.agentCommissionCents, 2400);
});

test('duplicate redemption and invalid cashier safeguards remain atomic', async () => {
  const before = await cashierSnapshot(pg);
  await assert.rejects(issueCashier(pg, { number: 80 }), { code: '23505' });
  await assert.rejects(issueCashier(pg, { number: 81, tag: 999 }), { code: '23503' });
  assert.deepEqual(await cashierSnapshot(pg), before);
});

test('new dancer earnings, account enrollment and exports are blocked even for service role', async () => {
  const before = await cashierSnapshot(pg);
  await assert.rejects(pg.query("insert into commission_events(dancer_id,amount_cents,status) values($1,100,'pending')", [cashierId(2)]), /program has ended/);
  await assert.rejects(pg.query("update nats_affiliate_accounts set status='requested' where dancer_id=$1", [cashierId(2)]), /program has ended/);
  await assert.rejects(pg.query("insert into nats_affiliate_accounts(dancer_id,login_id,status) values($1,200,'requested')", [cashierId(2)]), /program has ended/);
  await assert.rejects(pg.query("insert into nats_commission_exports(commission_event_id,dancer_id,amount_cents) values($1,$2,100)", [historical.commission_events[0].id, cashierId(2)]), /program has ended/);
  await assert.rejects(pg.query('insert into dancer_payout_batches(id) values($1)', [cashierId(90)]), /program has ended/);
  assert.deepEqual(await cashierSnapshot(pg), before);
});

test('dancer export dispatch is inaccessible while agent dispatch remains available', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await pg.exec('set role ' + role);
    await assert.rejects(pg.query('select * from claim_nats_commission_exports(100)'), { code: '42501' });
  }
  const { rows: [access] } = await pg.query("select has_function_privilege('service_role','claim_nats_agent_commission_exports(integer)','execute') allowed");
  assert.equal(access.allowed, true);
});

test('browser roles still cannot execute cashier financial mutations', async () => {
  for (const role of ['anon', 'authenticated']) {
    await pg.exec('set role ' + role);
    await assert.rejects(issueCashier(pg, { number: 91 }), { code: '42501' });
  }
  await pg.exec('set role service_role');
});
