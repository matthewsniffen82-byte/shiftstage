import { createHmac } from 'node:crypto';
export const ids = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  setupId: '33333333-3333-4333-8333-333333333333',
  applicationId: '44444444-4444-4444-8444-444444444444',
  kycId: '55555555-5555-4555-8555-555555555555',
};
export const identity = () => ({ id: ids.sessionId, applicationId: ids.applicationId,
  externalReferenceId: ids.attemptId, setup: { id: ids.setupId }, status: 'Completed',
  step: { kycIdentification: { id: ids.kycId, isSuccess: true } } });
export const identification = () => ({ id: ids.kycId, identityVerificationId: ids.sessionId,
  applicationId: ids.applicationId, externalReferenceId: ids.attemptId, status: 'Approved',
  completedUtc: '2026-01-01T00:00:00Z', document: { type: 'Passport', dateOfBirth: '1990-01-01' },
  rules: ['SelfieHasFace', 'DocumentHasFace', 'SelfieAndDocumentFacesMatch', 'SuccessfulPassiveLivenessCheck']
    .map(name => ({ name, status: 'Success' })),
});
export const signature = (raw, secret, timestamp = Math.floor(Date.now()/1000)) =>
  `t=${timestamp}, s=${createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')}`;
