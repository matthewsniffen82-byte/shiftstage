import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { processDancerPayouts } from '../src/lib/dancr/finance-payout-processing.ts';
import { createPayoutDispatchDatabase, seedPayoutDispatchDatabase, payoutSnapshot } from './helpers/payout-dispatch-database.mjs';
let pg;
before(async () => { pg = await createPayoutDispatchDatabase(); });
beforeEach(async () => seedPayoutDispatchDatabase(pg));
after(async () => pg?.close());

for (const status of ['requested', 'processing', 'paid', 'failed', 'canceled']) {
  test('retired dispatch leaves historical ' + status + ' payouts and reservations unchanged', async () => {
    await pg.query('update dancer_payout_batches set status=$1', [status]);
    const before = await payoutSnapshot(pg);
    const client = new Proxy({}, { get() { throw Error('Retired dispatch attempted a database/provider request'); } });
    const results = await Promise.all([processDancerPayouts(client), processDancerPayouts(client)]);
    for (const result of results) assert.deepEqual(result, { created: 0, failed: 0, disabled: true, errors: [] });
    assert.deepEqual(await payoutSnapshot(pg), before);
  });
}
