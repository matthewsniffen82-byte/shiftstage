import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { diditHostedUrl, evaluateDiditDecision, isAdultDateOfBirth, verifyDiditWebhook } from '../src/lib/dancr/didit-policy.ts';

const now = new Date('2026-09-17T12:00:00Z');
const expected = { sessionId: '11111111-1111-4111-8111-111111111111', workflowId: 'live-workflow', attemptId: 'private-attempt' };
const decision = () => ({ session_id: expected.sessionId, workflow_id: expected.workflowId, vendor_data: expected.attemptId,
  session_kind: 'user', environment: 'live', status: 'Approved', id_verifications: [{ status: 'Approved', date_of_birth: '2000-01-01' }],
  liveness_checks: [{ status: 'Approved' }], face_matches: [{ status: 'Approved' }] });

test('document DOB enforces the eighteenth birthday and rejects invalid dates', () => {
  for (const dob of ['2008-09-17', '2000-02-29', '1980-01-01']) assert.equal(isAdultDateOfBirth(dob, now), true);
  for (const dob of ['2008-09-18', '2020-01-01', '2000-02-30', '2028-01-01', '1900-01-01', '2000-13-01', '18', null, 18]) assert.equal(isAdultDateOfBirth(dob, now), false);
  assert.equal(isAdultDateOfBirth('2008-02-29', new Date('2026-02-28T23:59:59Z')), false);
  assert.equal(isAdultDateOfBirth('2008-02-29', new Date('2026-03-01T00:00:00Z')), true);
});
test('only a bound ID plus liveness and face match approval proves adulthood', () => {
  assert.equal(evaluateDiditDecision(decision(), expected, now), 'verified');
  for (const key of ['id_verifications', 'liveness_checks', 'face_matches']) {
    for (const value of [undefined, [], [{ status: 'Declined' }]]) assert.notEqual(evaluateDiditDecision({ ...decision(), [key]: value }, expected, now), 'verified');
  }
  for (const dob of [null, '2008-09-18', 'not-a-date']) {
    assert.notEqual(evaluateDiditDecision({ ...decision(), id_verifications: [{ status: 'Approved', date_of_birth: dob, age: 99 }] }, expected, now), 'verified');
  }
  for (const status of ['In Review', 'Declined', 'Resubmitted', 'Not Started', 'Expired', 'unknown']) {
    assert.notEqual(evaluateDiditDecision({ ...decision(), status }, expected, now), 'verified');
  }
});
test('another account, workflow, session, or sandbox cannot authorize this account', () => {
  for (const change of [{ session_id: 'other' }, { vendor_data: 'other' }, { workflow_id: 'other' }, { session_kind: 'business' }, { environment: 'sandbox' }, { sandbox_scenario: 'approve' }]) {
    assert.throws(() => evaluateDiditDecision({ ...decision(), ...change }, expected, now), /MISMATCH/);
  }
});
test('hosted redirect cannot escape Didit or carry credentials', () => {
  assert.equal(diditHostedUrl('https://verify.didit.me/en/session/token'), 'https://verify.didit.me/en/session/token');
  for (const url of ['https://verify.didit.me.evil.test/', 'http://verify.didit.me/', 'https://evil.test/', 'https://x@verify.didit.me/', 'javascript:alert(1)', 'https://verify.didit.me:444/', null]) assert.equal(diditHostedUrl(url), null);
});
test('raw signed webhooks reject tampering, stale timestamps and unsigned timestamp changes', () => {
  const payload = { session_id: expected.sessionId, timestamp: Math.floor(now.getTime() / 1000), webhook_type: 'status.updated', status: 'Approved', name: 'José' };
  const raw = JSON.stringify(payload), secret = 'synthetic-webhook-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  const headers = new Headers({ 'x-timestamp': String(payload.timestamp), 'x-signature': signature });
  assert.equal(verifyDiditWebhook(raw, headers, secret, now.getTime()).session_id, expected.sessionId);
  assert.equal(verifyDiditWebhook(raw.replace('Approved', 'Declined'), headers, secret, now.getTime()), null);
  assert.equal(verifyDiditWebhook(raw, headers, secret, now.getTime() + 301_000), null);
  headers.set('x-timestamp', String(payload.timestamp + 400));
  assert.equal(verifyDiditWebhook(raw, headers, secret, now.getTime() + 400_000), null);
  headers.delete('x-signature'); headers.set('x-signature-simple', signature);
  assert.equal(verifyDiditWebhook(raw, headers, secret, now.getTime()), null);
});
test('V2 signature accepts sorted nested unicode JSON but rejects edits', () => {
  const payload = { timestamp: Math.floor(now.getTime() / 1000), session_id: expected.sessionId, details: { z: ['é', '漢字'], a: true } };
  const canonical = `{"details":{"a":true,"z":["é","漢字"]},"session_id":"${expected.sessionId}","timestamp":${payload.timestamp}}`;
  const headers = new Headers({ 'x-timestamp': String(payload.timestamp), 'x-signature-v2': createHmac('sha256', 'secret').update(canonical).digest('hex') });
  assert.ok(verifyDiditWebhook(JSON.stringify(payload, null, 2), headers, 'secret', now.getTime()));
  assert.equal(verifyDiditWebhook(JSON.stringify({ ...payload, details: {} }), headers, 'secret', now.getTime()), null);
});
