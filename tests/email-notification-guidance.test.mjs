import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

const require = createRequire(import.meta.url);
const field = 'mydancr_email_guidance_acknowledged_v1';
const cacheKey = id => `mydancr:email-guidance:acknowledged:v1:${id}`;
const plain = value => JSON.parse(JSON.stringify(value));
function compile(file, dependencies, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, Request, Response, Error, AbortController, ...globals, require: name => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('.css')) return {};
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  } });
  return exports;
}

function api({ denied = false, fail = false, confirm = true, metadata = {} } = {}) {
  const users = {
    first: { display_name: 'Keep name', mydancr_venue_notify_emailEnabled: true, ...metadata },
    second: {},
  };
  const writes = [];
  const routes = compile('app/api/account/email-guidance/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/api': { apiError: error => Response.json({ ok: false, error: 'Unable to save.' }, { status: error.status || 500 }) },
    '@/src/lib/bounded-json-body': { readBoundedJsonObject },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async request => {
      const id = request.headers.get('authorization')?.replace('Bearer ', '');
      if (denied || !users[id]) throw Object.assign(new Error('Sign in required.'), { status: 401 });
      return { user: { id, user_metadata: users[id] }, session: { accessToken: 'refreshed' } };
    } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ auth: { admin: {
      updateUserById: async (id, patch) => {
        writes.push({ id, ...plain(patch) });
        if (fail) return { data: { user: null }, error: new Error('PRIVATE provider error') };
        if (confirm) Object.assign(users[id], patch.user_metadata);
        return { data: { user: { id, user_metadata: users[id] } }, error: null };
      },
    } } }) },
  });
  const request = (method, body, id = 'first') => new Request('https://example.test/api/account/email-guidance', {
    method, headers: { authorization: `Bearer ${id}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { writes, users, get: (id = 'first') => routes.GET(request('GET', undefined, id)),
    save: (body = { acknowledged: true }, id = 'first') => routes.PATCH(request('PATCH', body, id)) };
}

test('acknowledgment persists on the verified account and leaves email delivery and other accounts unchanged', async () => {
  const f = api();
  assert.equal((await (await f.get()).json()).acknowledged, false);
  const saved = await f.save();
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).acknowledged, true);
  assert.deepEqual(f.writes, [{ id: 'first', user_metadata: { [field]: true } }]);
  assert.equal(f.users.first.display_name, 'Keep name');
  assert.equal(f.users.first.mydancr_venue_notify_emailEnabled, true);
  const reloaded = await f.get();
  assert.match(reloaded.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await reloaded.json()).acknowledged, true);
  assert.equal((await (await f.get('second')).json()).acknowledged, false);
  await f.save();
  assert.equal(f.writes.length, 1, 'Repeated acknowledgment is idempotent');
});

test('signed-out requests and invalid updates never write metadata', async () => {
  const denied = api({ denied: true });
  for (const response of [await denied.get(), await denied.save()]) {
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
  assert.equal(denied.writes.length, 0);
  const f = api();
  for (const body of [{}, { acknowledged: false }, { acknowledged: 'true' }, { acknowledged: true, userId: 'second' },
    { acknowledged: true, mydancr_venue_notify_emailEnabled: false }, { acknowledged: true, extra: 'x'.repeat(300) }]) {
    assert.ok([400, 413].includes((await f.save(body)).status));
  }
  assert.equal(f.writes.length, 0);
});

test('provider failures or unconfirmed writes do not acknowledge the box', async () => {
  for (const options of [{ fail: true }, { confirm: false }]) {
    const f = api(options);
    const response = await f.save();
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /PRIVATE/);
    assert.equal((await (await f.get()).json()).acknowledged, false);
  }
  assert.equal((await (await api({ metadata: { [field]: 'true' } }).get()).json()).acknowledged, false);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function client({ storage = new Map(), unavailableStorage = false, request = async () => ({ userId: 'first', acknowledged: false }) } = {}) {
  const slots = [], calls = [], listeners = new Map();
  let cursor = 0, effects = [], dirty = false, tree, sessionId = 'first';
  const props = { accountId: 'first', accountRole: 'venue' };
  const Component = compile('app/components/EmailNotificationGuidance.tsx', {
    react: {
      useState(initial) {
        const index = cursor++;
        slots[index] ||= { value: initial };
        return [slots[index].value, value => {
          const next = typeof value === 'function' ? value(slots[index].value) : value;
          if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
        }];
      },
      useRef(initial) { return slots[cursor++] ||= { current: initial }; },
      useEffect(work, dependencies) {
        const index = cursor++, previous = slots[index];
        if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
          effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: work() }; });
        }
      },
    },
    '../dashboard/dashboard-session': {
      readSession: () => sessionId ? { account: { id: sessionId } } : null,
      requestDashboardJson: (path, options) => { calls.push({ path, options }); return request(options, sessionId); },
    },
  }, { window: {
    localStorage: {
      getItem(key) { if (unavailableStorage) throw new Error('Disabled'); return storage.get(key) ?? null; },
      setItem(key, value) { if (unavailableStorage) throw new Error('Disabled'); storage.set(key, value); },
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  } }).default;
  function render() {
    for (let i = 0; i < 10; i++) {
      dirty = false; cursor = 0; effects = []; tree = Component(props); effects.forEach(effect => effect());
      if (!dirty) return tree;
    }
    assert.fail('Component did not settle');
  }
  function nodes(node = tree) {
    return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : [];
  }
  return { calls, props, storage, render, nodes, tree: () => tree,
    button: () => nodes().find(node => node.type === 'button'),
    async settle() { await flush(); return render(); },
    session(id) { sessionId = id; },
    storageEvent(event) { listeners.get('storage')?.(event); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('Got it hides the box only after a successful save and stays hidden after remount without another lookup', async () => {
  const save = deferred(), storage = new Map();
  const f = client({ storage, request: async options => options.method === 'PATCH' ? save.promise : { userId: 'first', acknowledged: false } });
  assert.equal(f.render(), null, 'No flash while loading the account preference');
  await f.settle();
  assert.equal(f.button().props.children, 'Got it');
  f.button().props.onClick(); f.button().props.onClick(); f.render();
  assert.equal(f.button().props.disabled, true);
  assert.equal(f.calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { acknowledged: true });
  save.resolve({ userId: 'first', acknowledged: true });
  assert.equal(await f.settle(), null);
  f.unmount();
  const reopened = client({ storage });
  assert.equal(reopened.render(), null);
  assert.equal(reopened.calls.length, 0);
  reopened.unmount();
});

test('another device reads the saved acknowledgment and another account still sees its own guidance', async () => {
  const f = client({ request: async (_options, id) => ({ userId: id, acknowledged: id === 'first' }) });
  f.render();
  assert.equal(await f.settle(), null);
  f.session('second'); f.props.accountId = 'second'; f.render();
  await f.settle();
  assert.equal(f.tree().type, 'aside');
  assert.ok(f.button());
  f.unmount();
});

test('all dashboard types retain their account-specific explanation and acknowledgment control', async () => {
  for (const [accountRole, clubApplication, expected] of [
    ['customer', false, /followed dancers/], ['dancer', false, /VIP selections/],
    ['venue', false, /Table and VIP requests/], ['venue', true, /club application/],
    ['vip', false, /confirmed visits/], ['admin', false, /Support messages/],
  ]) {
    const f = client();
    Object.assign(f.props, { accountRole, clubApplication });
    f.render(); await f.settle();
    assert.match(f.nodes().find(node => node.type === 'strong').props.children, expected);
    assert.equal(f.button().props.children, 'Got it');
    f.unmount();
  }
});

test('failed acknowledgments remain visible with retry and work when local storage is unavailable', async () => {
  let attempts = 0;
  const f = client({ unavailableStorage: true, request: async options => {
    if (options.method === 'PATCH' && !attempts++) throw new Error('Offline');
    return { userId: 'first', acknowledged: options.method === 'PATCH' };
  } });
  f.render(); await f.settle(); f.button().props.onClick(); await f.settle();
  assert.ok(f.nodes().some(node => node.props?.role === 'alert'));
  assert.equal(f.button().props.disabled, false);
  f.button().props.onClick();
  assert.equal(await f.settle(), null);
  f.unmount();
});

test('an unavailable preference lookup still lets the user acknowledge the explanation', async () => {
  const f = client({ request: async options => {
    if (!options.method) throw new Error('Offline');
    return { userId: 'first', acknowledged: true };
  } });
  f.render(); await f.settle();
  f.button().props.onClick();
  assert.equal(await f.settle(), null);
  f.unmount();
});

test('account changes and unmounts discard late acknowledgment responses', async () => {
  for (const cancel of [f => f.session('second'), f => f.unmount()]) {
    const save = deferred();
    const f = client({ request: async options => options.method ? save.promise : { userId: 'first', acknowledged: false } });
    f.render(); await f.settle(); f.button().props.onClick();
    cancel(f); save.resolve({ userId: 'first', acknowledged: true }); await flush();
    assert.equal(f.storage.size, 0);
    f.unmount();
  }
});

test('a late read cannot reveal a box acknowledged in another tab', async () => {
  const lookup = deferred(), f = client({ request: () => lookup.promise });
  f.render();
  f.storage.set(cacheKey('first'), '1');
  f.storageEvent({ key: cacheKey('first'), newValue: '1' });
  lookup.resolve({ userId: 'first', acknowledged: false });
  assert.equal(await f.settle(), null);
  f.unmount();
});
