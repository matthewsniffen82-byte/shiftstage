import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateVeriffDecision, isAdultDateOfBirth, signVeriff, verifyVeriffPayload } from '../src/lib/dancr/veriff-policy.ts';
import { veriffApiUrl, veriffHostedUrl } from '../src/lib/dancr/veriff-url.ts';

const now = new Date('2026-09-17T12:00:00Z');
const expected = { sessionId: '11111111-1111-4111-8111-111111111111', attemptId: 'opaque-server-attempt' };
const decision = () => ({ status: 'success', verification: { id: expected.sessionId, vendorData: expected.attemptId,
  status: 'approved', code: 9001, attemptId: '22222222-2222-4222-8222-222222222222', decisionTime: '2026-09-17T10:00:00Z',
  person: { dateOfBirth: '2008-09-17' }, document: { type: 'DRIVERS_LICENSE' } } });
const config = { apiKey: 'test-api-key', sharedSecret: 'test-shared-secret', integrationId: '33333333-3333-4333-8333-333333333333' };

test('18+ boundary uses a valid document birthday, including leap-day and impossible dates', () => {
  assert.equal(isAdultDateOfBirth('2008-09-17', now), true);
  for (const dob of ['2008-09-18', '2027-01-01', '2008-02-30', '1900-01-01', '', '18', null, undefined]) assert.equal(isAdultDateOfBirth(dob, now), false);
  assert.equal(isAdultDateOfBirth('2008-02-29', new Date('2026-02-28T23:59:00Z')), false);
  assert.equal(isAdultDateOfBirth('2008-02-29', new Date('2026-03-01T00:00:00Z')), true);
});
test('only a bound, approved government document decision for an adult authorizes access', () => {
  assert.equal(evaluateVeriffDecision(decision(), expected, now), 'verified');
  for (const patch of [{ code: 9102 }, { status: 'review' }, { document: null }, { document: { type: 'BANK_STATEMENT' } },
    { person: { dateOfBirth: '2008-09-18', age: 99 } }, { person: { yearOfBirth: '1990' } }, { attemptId: null },
    { decisionTime: null }, { decisionTime: '2027-01-01T00:00:00Z' }]) {
    assert.notEqual(evaluateVeriffDecision({ ...decision(), verification: { ...decision().verification, ...patch } }, expected, now), 'verified');
  }
  for (const patch of [{ id: 'another-session' }, { vendorData: 'another-account' }]) {
    assert.throws(() => evaluateVeriffDecision({ ...decision(), verification: { ...decision().verification, ...patch } }, expected, now), /MISMATCH/);
  }
  assert.throws(() => evaluateVeriffDecision({ ...decision(), environment: 'test' }, expected, now), /MISMATCH/);
});
test('nonfinal and failure decisions preserve the right retry/review behavior', () => {
  assert.equal(evaluateVeriffDecision({ status: 'success', verification: null }, expected, now), null);
  for (const [status, code, result] of [['declined', 9102, 'declined'], ['expired', 9104, 'expired'], ['abandoned', 9121, 'expired'],
    ['resubmission_requested', 9103, 'pending'], ['review', 9122, 'in_review'], ['future_status', 9999, 'in_review']]) {
    assert.equal(evaluateVeriffDecision({ status: 'success', verification: { ...decision().verification, status, code } }, expected, now), result);
  }
});
test('hosted and API URLs accept only exact Veriff hosts, HTTPS, and the intended paths', () => {
  for (const host of ['saas.veriff.com', 'alchemy.veriff.com', 'eu.veriff.com', 'us.veriff.com', 'magic.veriff.me', 'magic.us.veriff.me']) {
    assert.equal(veriffHostedUrl(`https://${host}/v/token`), `https://${host}/v/token`);
  }
  for (const url of ['https://saas.veriff.com.evil.test/v/x', 'https://evil.test/v/x', 'https://x@saas.veriff.com/v/x',
    'http://saas.veriff.com/v/x', 'https://saas.veriff.com:444/v/x', 'https://saas.veriff.com/', 'https://saas.veriff.com/v/',
    'https://verify.didit.me/v/x', 'javascript:alert(1)', null]) assert.equal(veriffHostedUrl(url), null);
  assert.equal(veriffApiUrl('https://api-saas.veriff.com/'), 'https://api-saas.veriff.com');
  assert.equal(veriffApiUrl('https://stationapi.veriff.com'), 'https://stationapi.veriff.com');
  for (const url of ['https://api-saas.veriff.com/v1', 'https://api-saas.veriff.com?token=x', 'https://api-saas.veriff.com.evil.test', 'http://localhost']) assert.equal(veriffApiUrl(url), null);
});
test('raw-body HMAC validation rejects tampering, unsigned, malformed, and wrong-integration messages', () => {
  const raw = JSON.stringify(decision());
  const headers = new Headers({ 'x-auth-client': config.apiKey, 'x-hmac-signature': signVeriff(raw, config.sharedSecret), 'vrf-integration-id': config.integrationId });
  assert.equal(verifyVeriffPayload(raw, headers, config).verification.id, expected.sessionId);
  assert.equal(verifyVeriffPayload(raw.replace('approved', 'declined'), headers, config), null);
  assert.equal(verifyVeriffPayload(raw, new Headers(), config), null);
  for (const patch of [{ 'x-auth-client': 'wrong' }, { 'vrf-auth-client': 'conflict' }, { 'x-hmac-signature': 'xyz' },
    { 'vrf-hmac-signature': '0'.repeat(64) }, { 'vrf-integration-id': 'wrong' }]) {
    const altered = new Headers(headers); for (const [key, value] of Object.entries(patch)) altered.set(key, value);
    assert.equal(verifyVeriffPayload(raw, altered, config), null);
  }
  assert.ok(verifyVeriffPayload(raw, new Headers({ 'vrf-auth-client': config.apiKey, 'vrf-hmac-signature': signVeriff(raw, config.sharedSecret).toUpperCase() }), config));
  for (const raw of ['null', '[]', '{bad']) assert.equal(verifyVeriffPayload(raw, new Headers({ 'x-auth-client': config.apiKey, 'x-hmac-signature': signVeriff(raw, config.sharedSecret) }), config), null);
});
