import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { validateRequestTerms } from '../src/lib/dancr/request-terms.ts';
import { requestRoleFixture } from './helpers/request-role-fixture.mjs';

const uuid = '11111111-1111-4111-8111-111111111111';
function load(path, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../'+path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, URL, performance, require(name) {
    if (name === 'server-only') return {};
    if (name.includes('api-error-policy')) return { PublicApiError, resolveApiError };
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  return exports;
}
const { recordRequestTerms } = load('src/lib/dancr/request-terms-server.ts', { './request-terms': { validateRequestTerms } });
const { recordBiometricConsent } = load('src/lib/dancr/biometric-consent.ts', { './biometric-consent-version': { BIOMETRIC_NOTICE_VERSION: '2026-10-30' } });
const terms = { id: uuid, userTermsAccepted: true, userTermsVersion: '2026-10-30' };

test('public receipt helper rejects unchecked and partial table consent before any database write', async () => {
  const admin = { rpc: () => assert.fail('No consent write for an invalid choice') };
  for (const input of [null, {}, { ...terms, userTermsAccepted: false }, { ...terms, userTermsVersion: 'old' }]) {
    await assert.rejects(recordRequestTerms(admin, input, { flow: 'ride', action: 'submit', reference: uuid }), e => e.status === 400);
  }
  await assert.rejects(recordRequestTerms(admin, terms, { flow: 'table', action: 'cancel', reference: uuid }), e => e.status === 400);
});

test('public receipt helper fails closed on unavailable, malformed or mismatched receipts', async () => {
  for (const response of [{ error: new Error('offline') }, { data: {} }, { data: { id: 'different', acceptedAt: new Date().toISOString() } }]) {
    await assert.rejects(recordRequestTerms({ rpc: async () => response }, terms, { flow: 'guest_list', action: 'submit', reference: uuid }), e => e.status === 503);
  }
});

test('verification route records separate consent before starting capture and never starts on consent failure', async () => {
  for (const [body, unavailable, status] of [[{}, false, 400], [{ biometricConsent: false }, false, 400], [{ biometricConsent: true, noticeVersion: 'old', consentId: uuid }, false, 400], [{ biometricConsent: true, noticeVersion: '2026-10-30', consentId: uuid }, true, 503], [{ biometricConsent: true, noticeVersion: '2026-10-30', consentId: uuid }, false, 200]]) {
    const calls = [];
    const route = load('app/api/dancer/age-verification/route.ts', {
      'next/server': { NextResponse },
      '@/src/lib/api': { apiError: e => NextResponse.json({ error: 'failed' }, { status: e.status || 500 }) },
      '@/src/lib/dancr/ondato': { startDancerAgeVerification: async () => { calls.push('capture'); return {}; }, refreshDancerAgeVerification: async () => { calls.push('refresh'); return {}; } },
      '@/src/lib/dancr/public-request-rate-limit': { enforcePublicRequestRateLimit: async () => {}, PublicRequestRateLimitError: class extends Error {} },
      '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ rpc: async () => { calls.push('consent'); return unavailable ? { error: true } : { data: { id: uuid, acceptedAt: new Date().toISOString() } }; } }) },
      '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ user: { id: 'user' } }) },
      '@/src/lib/bounded-json-body': { readBoundedJsonObject },
      '@/src/lib/dancr/biometric-consent': { recordBiometricConsent },
    });
    const response = await route.POST(new Request('https://test.invalid/api/dancer/age-verification', { method: 'POST', body: JSON.stringify(body) }));
    assert.equal(response.status, status);
    assert.deepEqual(calls, status === 200 ? ['consent', 'capture'] : status === 503 ? ['consent'] : []);
    calls.length = 0;
    assert.equal((await route.POST(new Request('https://test.invalid/api/dancer/age-verification?action=refresh', { method: 'POST' }))).status, 200);
    assert.deepEqual(calls, ['refresh']);
  }
});

const request = (path, method = 'POST', body = {}) => new Request('https://test.invalid'+path, { method, headers: { authorization: 'Bearer synthetic' }, ...(['GET','HEAD'].includes(method) ? {} : { body: JSON.stringify(body) }) });
test('both authentication paths enforce current customer terms for new activity and combined VIP terms', async () => {
  for (const refresh of [false, true]) {
    for (const path of ['/api/customer/favorites','/api/customer/follows','/api/customer/venue-follows','/api/customer/going','/api/customer/directions','/api/customer/deal-saves','/api/vip']) {
      const f = requestRoleFixture({ role: 'customer', termsAccepted: false });
      const input = request(path); if (refresh) input.headers.set('x-dancr-refresh-token','synthetic-refresh');
      await assert.rejects(f.createContext(input), e => e.status === 403);
      assert.equal(f.calls.find(c => c[0] === 'terms')[2], path === '/api/vip');
      await requestRoleFixture({ role: 'customer' }).createContext(request(path));
    }
  }
});

test('privacy, support, deletion, viewing and explicit withdrawals remain available without new acceptance', async () => {
  const f = requestRoleFixture({ role: 'customer', termsAccepted: false });
  for (const [path, method, body] of [
    ['/api/customer/favorites','POST',{ favorite: false }], ['/api/customer/follows','POST',{ following: false }],
    ['/api/customer/venue-follows','POST',{ following: false }], ['/api/customer/going','POST',{ going: false }],
    ['/api/customer/deal-saves','POST',{ saved: false }], ['/api/vip','DELETE',{}], ['/api/vip','GET'],
    ['/api/account','DELETE',{}], ['/api/account/terms','POST',{}], ['/api/customer/club-privacy','POST',{}], ['/api/support','POST',{}],
  ]) await f.createContext(request(path, method, body));
  assert.equal(f.calls.some(c => c[0] === 'terms'), false);
  const dancer = requestRoleFixture({ role: 'dancer', termsAccepted: false });
  await dancer.createContext(request('/api/customer/favorites')); assert.equal(dancer.calls.some(c => c[0] === 'terms'), false);
});

test('shared-table submit and cancel cannot mutate without a durable combined acceptance; previews stay read-only', async () => {
  const path = 'app/api/internal/[[...path]]/route.ts';
  const imports = Object.fromEntries([...readFileSync(new URL('../'+path,import.meta.url),'utf8').matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
  for (const cancel of [false, true]) for (const mode of ['missing','unchecked','partial','unavailable','preview','accepted']) {
    const calls = [];
    const admin = { rpc: async name => { calls.push(name); return name === 'record_request_terms_acceptance' ? mode === 'unavailable' ? { error: true } : { data: { id: uuid, acceptedAt: new Date().toISOString() } } : { data: { id: uuid } }; } };
    const route = load(path, { ...imports,
      'next/server': { NextResponse, after: () => {} },
      '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
      '@/src/lib/bounded-json-body': { readBoundedJsonObject },
      '@/src/lib/api-error-policy': { PublicApiError, resolveApiError },
      '@/src/lib/dancr/request-terms-server': { recordRequestTerms },
      '@/src/lib/dancr/internal-roster': { INTERNAL_HEADERS: {}, internalError: e => e, isInternalUuid: v => v === uuid, internalScope: async () => ({ preview: mode === 'preview', venueId: uuid, link: { id: uuid, kind: 'table' } }) },
      '@/src/lib/dancr/internal-request-cancel': { cancelInternalRequest: async () => { calls.push('cancel'); return { id: uuid }; } },
    });
    const body = { dancerId: uuid, requestKey: uuid, ...(cancel ? { action: 'cancel_request', requestId: uuid } : {}),
      ...(mode === 'missing' ? {} : { termsAcceptance: { ...terms, userTermsAccepted: mode !== 'unchecked', ...(mode === 'partial' ? {} : { accessTermsAccepted: true, accessTermsVersion: '2026-10-30' }) } }) };
    const response = await route.POST(request('/api/internal/link/token','POST',body), { params: Promise.resolve({ path: ['link','token'] }) });
    assert.equal(response.status, mode === 'accepted' ? 200 : mode === 'preview' ? 403 : mode === 'unavailable' ? 503 : 400);
    assert.deepEqual(calls, mode === 'accepted' ? ['record_request_terms_acceptance', cancel ? 'cancel' : 'internal_roster_request'] : mode === 'unavailable' ? ['record_request_terms_acceptance'] : []);
  }
});
