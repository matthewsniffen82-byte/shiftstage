import assert from 'node:assert/strict';
import test from 'node:test';
import { requestAdminJson } from '../app/admin/admin-session.ts';
import { BROWSER_AUTH_SESSION_KEY } from '../src/lib/dancr/browser-session.ts';

for (const bodyStalls of [false, true]) test(`admin deadlines bound stalled ${bodyStalls ? 'bodies' : 'headers'} without replaying writes`, async () => {
  const priorWindow = globalThis.window, priorFetch = globalThis.fetch;
  const original = JSON.stringify({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', account: { id: 'admin', role: 'admin' } });
  const storage = new Map([[BROWSER_AUTH_SESSION_KEY, original]]);
  const events = [];
  globalThis.window = { localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) }, dispatchEvent: e => events.push(e) };
  let signal, settle, calls = 0;
  const late = new Promise(resolve => { settle = resolve; });
  globalThis.fetch = async (_path, options) => {
    calls++; signal = options.signal;
    return bodyStalls ? { ok: true, status: 200, json: () => late } : late;
  };
  try {
    await assert.rejects(requestAdminJson('/api/media-batches', { method: 'POST', timeoutMs: 10 }), { status: 408, message: /check its status before trying again/i });
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
    const data = { ok: true, session: { accessToken: 'late-access', refreshToken: 'late-refresh' } };
    settle(bodyStalls ? data : { ok: true, status: 200, json: async () => data });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(storage.get(BROWSER_AUTH_SESSION_KEY), original);
    assert.equal(events.length, 0);
  } finally { globalThis.window = priorWindow; globalThis.fetch = priorFetch; }
});

for (const [scenario, method, reply, status, message] of [
  ['offline read', 'GET', async () => { throw new TypeError('Failed to fetch'); }, 0, /check your connection/i],
  ['offline decision', 'POST', async () => { throw new TypeError('Failed to fetch'); }, 0, /check its status before trying again/i],
  ['unreadable decision receipt', 'POST', async () => new Response('<html>'), 200, /check its status/i],
  ['rate-limited refresh', 'GET', async () => new Response(null, { status: 429 }), 429, /wait a moment/i],
  ['server challenge', 'POST', async () => Response.json({ error: 'Complete your identity check.', code: 'MFA_REQUIRED' }, { status: 403 }), 403, /complete your identity check/i],
]) {
  test(`admin shows an actionable message for ${scenario}`, async t => {
    const previous = globalThis.window;
    const session = JSON.stringify({ accessToken: 'fixture', account: { id: 'admin', role: 'admin' } });
    globalThis.window = { localStorage: { getItem: () => session } };
    t.after(() => { globalThis.window = previous; });
    t.mock.method(globalThis, 'fetch', reply);
    await assert.rejects(requestAdminJson('/api/admin/media-workspace', { method }), {
      status, message, ...(scenario === 'server challenge' ? { code: 'MFA_REQUIRED' } : {}),
    });
  });
}
