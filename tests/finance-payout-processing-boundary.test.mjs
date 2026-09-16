import assert from 'node:assert/strict';
import test from 'node:test';
import { processDancerPayouts } from '../src/lib/dancr/finance-payout-processing.ts';

for (const enabled of ['true', 'false']) test('retired payout processing never touches money even with PAYOUTS_ENABLED=' + enabled, async () => {
  const before = process.env.PAYOUTS_ENABLED;
  process.env.PAYOUTS_ENABLED = enabled;
  try {
    const client = new Proxy({}, { get() { throw new Error('Unexpected financial operation'); } });
    assert.deepEqual(await processDancerPayouts(client), { created: 0, failed: 0, disabled: true, errors: [] });
  } finally {
    if (before === undefined) delete process.env.PAYOUTS_ENABLED;
    else process.env.PAYOUTS_ENABLED = before;
  }
});
