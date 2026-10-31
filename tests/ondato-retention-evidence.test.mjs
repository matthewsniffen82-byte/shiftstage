import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeOndatoRetention } from '../src/lib/dancr/ondato-policy.ts';

test('private retention evidence separates configured settings from scheduled and completed provider events', () => {
  const result = summarizeOndatoRetention({ createdUtc: '2026-10-01T12:00:00Z', redaction: { events: [
    { scope: 'PersonalData', source: 'DataRetentionPolicy', status: 'Scheduled', createdUtc: '2026-10-01T12:00:00Z', completedUtc: null },
    { scope: 'BiometricData', source: 'SetupAutomated', status: 'Completed', createdUtc: '2026-10-01T12:05:00Z', completedUtc: '2026-10-01T12:06:00Z' },
  ] } }, { automaticRedactionSettings: { isEnabled: true, delay: '30.00:00:00', scopes: ['PersonalData', 'BiometricData'] } });
  assert.equal(result.identityCreatedAt, '2026-10-01T12:00:00.000Z');
  assert.deepEqual(result.automaticRedaction, { enabled: true, delay: '30.00:00:00', scopes: ['PersonalData', 'BiometricData'], unrecognizedScopeCount: 0 });
  assert.equal(result.eventCount, 2);
  assert.equal(result.events[0].status, 'Scheduled');
  assert.equal(result.events[0].completedAt, null);
  assert.equal(result.events[1].status, 'Completed');
  assert.equal(result.events[1].completedAt, '2026-10-01T12:06:00.000Z');
  assert.equal(result.eventsTruncated, false);
  assert.equal('compliant' in result, false);
});

test('missing provider metadata stays unknown and is distinct from an explicitly empty event history', () => {
  for (const value of [null, {}, [], 'private data']) {
    const result = summarizeOndatoRetention(value, value);
    assert.equal(result.identityCreatedAt, null);
    assert.deepEqual(result.automaticRedaction, { enabled: null, delay: null, scopes: null, unrecognizedScopeCount: null });
    assert.equal(result.redactionHistoryAvailable, false);
    assert.equal(result.eventCount, null);
    assert.deepEqual(result.events, []);
  }
  const result = summarizeOndatoRetention({ redaction: { events: [] } }, { automaticRedactionSettings: { isEnabled: false, delay: 'PT0S', scopes: [] } });
  assert.equal(result.redactionHistoryAvailable, true);
  assert.equal(result.eventCount, 0);
  assert.equal(result.automaticRedaction.enabled, false);
  assert.equal(result.automaticRedaction.delay, 'PT0S');
});

test('unexpected fields and malformed values cannot disclose provider identity data through diagnostics', () => {
  const secret = 'sensitive-document-or-client-data';
  const result = summarizeOndatoRetention({ createdUtc: secret, document: secret, redaction: { events: [
    { scope: secret, source: secret, status: secret, clientId: secret, createdUtc: secret, completedUtc: secret, notes: secret },
  ] } }, { automaticRedactionSettings: { isEnabled: secret, delay: secret, scopes: ['PersonalData', secret], clientId: secret } });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(result.events, [{ scope: null, source: null, status: null, createdAt: null, completedAt: null }]);
  assert.deepEqual(result.automaticRedaction, { enabled: null, delay: null, scopes: ['PersonalData'], unrecognizedScopeCount: 1 });
  for (const delay of ['P30D', 'PT720H', 'P1DT2H3M4.5S', '00:00:00', '30.00:00:00']) {
    assert.equal(summarizeOndatoRetention({}, { automaticRedactionSettings: { delay } }).automaticRedaction.delay, delay);
  }
  for (const delay of ['P', 'PT', 'P1DT', '00:99:00', '30 days', secret]) {
    assert.equal(summarizeOndatoRetention({}, { automaticRedactionSettings: { delay } }).automaticRedaction.delay, null);
  }
});

test('large and malformed event histories remain bounded without suggesting complete coverage', () => {
  const events = Array.from({ length: 101 }, () => ({ scope: 'PersonalData', source: 'OnDemand', status: 'InProgress' }));
  const result = summarizeOndatoRetention({ redaction: { events } }, {});
  assert.equal(result.events.length, 100);
  assert.equal(result.eventCount, 101);
  assert.equal(result.eventsTruncated, true);
  assert.deepEqual(summarizeOndatoRetention({ redaction: { events: [null, 'private'] } }, {}).events,
    Array.from({ length: 2 }, () => ({ scope: null, source: null, status: null, createdAt: null, completedAt: null })));
});
