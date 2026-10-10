import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';

const { passwordSetupCompleted, passwordLoginCompleted, recordPasswordSetup } = compileVip('src/lib/dancr/password-setup.ts', {
  '../security/safe-error-metadata': { safeErrorMetadata: () => ({}) },
}, { console: { warn() {} } });
const stamp = '2026-10-01T00:00:00.000Z';
const key = 'mydancr_password_setup_completed_at';
const loginKey = 'mydancr_password_login_at';

test('only successful password authentication completes both server-owned milestones', async () => {
  for (const extra of [{}, { last_sign_in_at: stamp }, { app_metadata: { [key]: stamp } }, { app_metadata: { [loginKey]: stamp } }, { app_metadata: { [key]: stamp }, user_metadata: { [loginKey]: stamp } }]) {
    assert.equal(passwordLoginCompleted({ id: 'guest', ...extra }), false);
  }
  const records = [];
  const admin = { auth: { admin: { updateUserById: async (id, input) => { records.push(input); return { data: { user: { id, app_metadata: input.app_metadata } } }; } } } };
  assert.equal(await recordPasswordSetup(admin, { id: 'guest', app_metadata: { [key]: stamp } }, { passwordLogin: true }), true);
  assert.equal(records[0].app_metadata[key], stamp);
  const completed = { id: 'guest', app_metadata: records[0].app_metadata };
  assert.equal(passwordLoginCompleted(completed), true);
  assert.equal(await recordPasswordSetup(admin, completed, { passwordLogin: true }), true); assert.equal(records.length, 1);
  assert.equal(await recordPasswordSetup(admin, { id: 'guest', app_metadata: { [key]: 'invalid' } }, { passwordLogin: true }), true);
});

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
