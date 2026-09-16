import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error('Unexpected import ' + name);
  } });
  return exports;
}

test('old authenticated and guest chat APIs are gone, without reading messages or accepting mutations', async () => {
  const retired = load('src/lib/dancr/pickup-retired.ts');
  const imports = {
    '@/src/lib/dancr/pickup-retired': retired,
    '@/src/lib/api': {}, '@/src/lib/supabase/request': {},
    '@/src/lib/dancr/pickup-server': {}, '@/src/lib/dancr/pickup-phone-requests': {},
  };
  for (const [path, methods] of [
    ['app/api/pickups/route.ts', ['POST']],
    ['app/api/pickups/[requestId]/route.ts', ['GET', 'POST']],
    ['app/api/pickups/guest-unread/route.ts', ['POST']],
    ['app/api/pickups/settings/route.ts', ['POST']],
  ]) {
    const api = load(path, imports);
    for (const method of methods) for (const headers of [{}, { authorization: 'Bearer old-session' }, { 'x-pickup-guest-key': 'a'.repeat(64) }]) {
      const response = await api[method](new Request('https://example.test/api/pickups', { method, headers }));
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(await response.json(), { ok: false, error: 'Pickup chat is no longer available. Open the club page to send a pickup contact form.' });
    }
  }
});

test('notification lists exclude retired chat alerts before pagination while keeping contact requests and notices without a kind', async () => {
  const { getUserNotifications } = load('src/lib/dancr/notifications.ts');
  const calls = [];
  const query = {
    select() { return this; }, eq(...args) { calls.push(['eq', ...args]); return this; },
    or(value) { calls.push(['or', value]); return this; }, order() { return this; }, limit() { return this; },
    then(resolve) { return Promise.resolve({ data: [{ id: 'request', payload: { kind: 'club_shuttle_request' } }, { id: 'notice', payload: {} }], error: null }).then(resolve); },
  };
  const result = await getUserNotifications({ from: () => query }, 'owner');
  assert.deepEqual(calls, [['eq', 'recipient_id', 'owner'], ['or', 'payload->>kind.is.null,payload->>kind.neq.club_pickup']]);
  assert.deepEqual(Array.from(result, row => row.id), ['request','notice']);
});
