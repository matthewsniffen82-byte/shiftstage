import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';

const { passwordSetupCompleted, recordPasswordSetup } = compileVip('src/lib/dancr/password-setup.ts', {
  '../security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
}, { console: { warn() {} } });
const stamp = '2026-10-01T00:00:00.000Z';
const key = 'mydancr_password_setup_completed_at';

test('password setup is independent of email confirmation, login history and editable metadata', () => {
  for (const extra of [{}, { email_confirmed_at: stamp }, { last_sign_in_at: stamp }, { user_metadata: { [key]: stamp } }, { app_metadata: { [key]: 'invalid' } }]) {
    assert.equal(passwordSetupCompleted({ id: 'guest', ...extra }), false);
  }
  assert.equal(passwordSetupCompleted({ id: 'guest', app_metadata: { [key]: stamp } }), true);
});

test('recording setup writes only the server-owned completion marker and is idempotent', async () => {
  const calls = [];
  const admin = { auth: { admin: { updateUserById: async (id, input) => {
    calls.push({ id, input }); return { data: { user: { id, app_metadata: input.app_metadata } }, error: null };
  } } } };
  assert.equal(await recordPasswordSetup(admin, { id: 'verified-guest' }), true);
  assert.equal(calls[0].id, 'verified-guest');
  assert.deepEqual(Object.keys(calls[0].input), ['app_metadata']);
  assert.deepEqual(Object.keys(calls[0].input.app_metadata), [key]);
  assert.equal(await recordPasswordSetup(admin, { id: 'verified-guest', app_metadata: calls[0].input.app_metadata }), true);
  assert.equal(calls.length, 1);
});

test('failed or unconfirmed recording never claims setup completed', async () => {
  assert.equal(await recordPasswordSetup(() => { throw new Error('unavailable'); }, { id: 'guest' }), false);
  for (const result of [{ error: { status: 503 } }, { data: { user: null } }, { data: { user: { id: 'other', app_metadata: { [key]: stamp } } } }]) {
    assert.equal(await recordPasswordSetup({ auth: { admin: { updateUserById: async () => result } } }, { id: 'guest' }), false);
  }
});
