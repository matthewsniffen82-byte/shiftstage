import assert from 'node:assert/strict';
import { sessions } from './helpers/internal-nfc-fixture.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';

const require = createRequire(import.meta.url);
const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function compile(file, dependencies, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Request, Response, URL, Error, AbortController, ...globals, require(name) {
    if (name === 'react/jsx-runtime') return require(name);
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  } });
  return exports;
}

function api({ authorized = true, active = true, links, databaseError = false } = {}) {
  const calls = [];
  const rows = links ?? [
    { id: id(8), venue_id: id(2), kind: 'table', active: true, token: id(18), created_at: '2026-01-01' },
    { id: id(9), venue_id: id(1), kind: 'table', active: false, token: id(19), created_at: '2026-01-01' },
    { id: id(10), venue_id: id(1), kind: 'display', active: true, token: id(20), created_at: '2026-01-01' },
    { id: id(11), venue_id: id(1), kind: 'table', active: true, token: id(21), created_at: '2026-01-03' },
    { id: id(12), venue_id: id(1), kind: 'table', active: true, token: id(22), created_at: '2026-01-02' },
  ];
  const admin = { from(table) {
    calls.push(table);
    let data = table === 'venues' ? [{ id: id(1), is_active: active }] : rows;
    let columns, maximum;
    const orders = [];
    const query = {
      select(value) { columns = value.split(','); return query; },
      eq(key, value) { data = data.filter(row => row[key] === value); return query; },
      order(key, options) { orders.push([key, options.ascending]); return query; },
      limit(value) { maximum = value; return query; },
      async maybeSingle() {
        const sorted = [...data].sort((a, b) => {
          for (const [key, ascending] of orders) {
            const delta = String(a[key]).localeCompare(String(b[key]));
            if (delta) return ascending ? delta : -delta;
          }
          return 0;
        }).slice(0, maximum);
        if (databaseError) return { data: null, error: new Error('PRIVATE database detail') };
        assert.ok(sorted.length <= 1, 'query must select one venue or table');
        return { data: sorted[0] ? Object.fromEntries(columns.map(key => [key, sorted[0][key]])) : null, error: null };
      },
    };
    return query;
  } };
  const route = compile('app/api/venue/internal-entry/route.ts', {
    'next/server': { NextResponse: Response },
    '@/src/lib/dancr/internal-tap-session': sessions,
    '@/src/lib/api-error-policy': { PublicApiError, resolveApiError },
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async (request, options) => {
      assert.equal(options.role, 'venue');
      if (request.headers.get('authorization') !== 'Bearer venue') throw new PublicApiError('AUTH_REQUIRED', 'Sign in required.', 401);
      return { user: { id: id(3) }, session: { accessToken: 'refreshed' } };
    } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => admin },
    '@/src/lib/dancr/venue-access': { requireVenueAccess: async (client, userId, permission) => {
      assert.equal(client, admin); assert.equal(userId, id(3)); assert.equal(permission, 'view_roster');
      if (!authorized) throw new PublicApiError('FORBIDDEN', 'Venue access required.', 403);
      return { venueId: id(1) };
    } },
    '@/src/lib/dancr/internal-roster': { isInternalUuid: uuid, INTERNAL_HEADERS: { 'cache-control': 'private, no-store, max-age=0', 'referrer-policy': 'no-referrer' } },
  });
  return { calls, get: (query = '', signedIn = true) => route.GET(new Request('https://mydancr.test/api/venue/internal-entry' + query, { headers: signedIn ? { authorization: 'Bearer venue' } : {} })) };
}

test('live entry opens the first active table belonging to the authenticated club and cannot be retargeted by URL parameters', async () => {
  const response = await api().get(`?venueId=${id(2)}&token=${id(18)}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.href, `/internal/club/${id(22)}`);
  assert.deepEqual(Object.keys(body).sort(), ['href', 'ok', 'session']);
  assert.equal(body.session.accessToken, 'refreshed');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('signed-out and unauthorized accounts cannot discover a live table link', async () => {
  for (const [fixture, signedIn, status] of [[api(), false, 401], [api({ authorized: false }), true, 403]]) {
    const response = await fixture.get('', signedIn);
    assert.equal(response.status, status);
    assert.equal((await response.json()).href, undefined);
    assert.equal(fixture.calls.length, 0);
  }
});

test('inactive clubs and clubs without an active table never fall back to another club or create QR codes', async () => {
  for (const options of [{ active: false }, { links: [] }, { links: [{ id: id(4), venue_id: id(1), active: true, kind: 'table', token: 'invalid', created_at: '2026-01-01' }] }]) {
    const response = await api(options).get();
    assert.equal(response.status, 404);
    assert.equal((await response.json()).href, undefined);
  }
});

test('database failures return an uncached, safe error instead of a link', async () => {
  const response = await api({ databaseError: true }).get();
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /PRIVATE|href|\/internal\/club\//);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function client(request) {
  const states = [], effects = [], navigations = [], calls = [];
  let stateIndex = 0, effectIndex = 0;
  let session = { account: { id: id(3), role: 'venue' } };
  const Component = compile('app/internal/InternalLiveEntry.tsx', {
    react: {
      useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
      useEffect(work, dependencies) { const index = effectIndex++; if (!effects[index] || dependencies.some((value, i) => value !== effects[index].dependencies[i])) { effects[index]?.cleanup?.(); effects[index] = { dependencies, cleanup: work() }; } },
    },
    '../dashboard/dashboard-session': {
      readSession: () => session,
      requestDashboardJson: async (path, options) => { calls.push({ path, options }); return request(); },
    },
  }, { window: { location: { replace: href => navigations.push(href) } } }).default;
  const render = () => { stateIndex = 0; effectIndex = 0; return Component(); };
  return { render, calls, states, navigations, setSession(value) { session = value; }, unmount() { effects.forEach(effect => effect.cleanup?.()); } };
}

test('the launcher replaces itself with the live QR page so browser Back returns to the dashboard', async () => {
  const h = client(async () => ({ href: `/internal/club/${id(22)}` }));
  assert.equal(h.render().props.children.props.role, 'status');
  await flush();
  assert.deepEqual(h.navigations, [`/internal/club/${id(22)}?from=club-dashboard`]);
  assert.equal(h.calls[0].path, '/api/venue/internal-entry');
  assert.equal(h.calls[0].options.expectedRole, 'venue');
  assert.equal(h.calls[0].options.cache, 'no-store');
  h.unmount();
});

for (const href of ['https://other.test/', '//other.test/', '/internal', '/internal/club/invalid', `/internal/club/${id(22)}?redirect=other`]) {
  test(`the launcher refuses an unexpected destination: ${href}`, async () => {
    const h = client(async () => ({ href })); h.render(); await flush();
    assert.deepEqual(h.navigations, []);
    assert.equal(h.render().props.children.props.role, 'alert');
    h.unmount();
  });
}

test('closing the launcher or changing accounts prevents a stale response from opening a club page', async () => {
  for (const change of [h => h.unmount(), h => h.setSession({ account: { id: id(4), role: 'venue' } }), h => h.setSession(null)]) {
    let resolve;
    const h = client(() => new Promise(done => { resolve = done; })); h.render();
    change(h); resolve({ href: `/internal/club/${id(22)}` }); await flush();
    assert.deepEqual(h.navigations, []);
    h.unmount();
  }
});

test('a failed live-page lookup shows its error and can be retried without showing the staff roster', async () => {
  let attempts = 0;
  const h = client(async () => { if (!attempts++) throw new Error('No active table page.'); return { href: `/internal/club/${id(22)}` }; });
  h.render(); await flush();
  const alert = h.render().props.children;
  assert.equal(alert.props.role, 'alert');
  assert.equal(alert.props.children[1].props.children, 'No active table page.');
  alert.props.children[2].props.children[0].props.onClick();
  h.render(); await flush();
  assert.deepEqual(h.navigations, [`/internal/club/${id(22)}?from=club-dashboard`]);
  h.unmount();
});
