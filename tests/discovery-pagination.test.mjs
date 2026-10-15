import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { discoveryCursor, parseDiscoveryCursor } from '../src/lib/dancr/discovery-pagination.ts';
import { fixture as rankingFixture, row, id } from './helpers/discovery-fixture.mjs';

function compile(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Date, console: { log() {}, warn() {} }, require: name => deps[name] || {} });
  return exports;
}
const service = compile('src/lib/dancr/public.ts', {
  './profile-approval': compile('src/lib/dancr/profile-approval.ts'),
  './markets': compile('src/lib/dancr/markets.ts'),
  './shift-presence': compile('src/lib/dancr/shift-presence.ts'),
  './responsive-image': { responsivePublicImage: () => null },
});
const profile = n => ({ id: id(n), stage_name: `Dancer ${n}`, slug: `dancer-${n}`, city: 'Las Vegas',
  status: 'approved', verification_status: 'approved', is_public: true, disabled_at: null,
  social_links: [], dancer_photos: [], live_shifts: [] });

function database(rows) {
  const queries = [];
  const client = createClient('https://synthetic.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.origin, 'https://synthetic.invalid');
      if (url.pathname.endsWith('/rpc/get_public_dancer_metric_counts')) return Response.json([]);
      assert.ok(url.pathname.endsWith('/dancer_profiles'));
      const q = url.searchParams; queries.push(q);
      for (const [key, value] of [['status', 'eq.approved'], ['verification_status', 'eq.approved'], ['disabled_at', 'is.null'], ['is_public', 'eq.true']]) {
        assert.equal(q.get(key), value);
      }
      assert.equal(q.get('order'), 'id.asc');
      assert.equal(q.get('limit'), '101');
      assert.equal(q.get('offset'), null);
      const city = q.get('city')?.slice('ilike.'.length), after = q.get('id')?.slice('gt.'.length);
      return Response.json(rows.filter(r => r.status === 'approved' && r.verification_status === 'approved'
        && r.is_public && !r.disabled_at && (!city || r.city === city) && (!after || r.id > after))
        .sort((a,b) => a.id.localeCompare(b.id)).slice(0, 101));
    } },
  });
  return { client, queries };
}

test('keyset pages reach every eligible profile beyond both 800 and 5,000 without duplicates', async () => {
  const rows = Array.from({ length: 5207 }, (_, i) => profile(i + 1));
  const f = database(rows), seen = [];
  let after = null;
  do {
    const page = await service.getLiveDancerDiscovery(f.client, 'All cities', after);
    assert.ok(page.dancers.length <= 100);
    seen.push(...page.dancers.map(r => r.id));
    after = page.nextAfterId;
    if (after) assert.equal(parseDiscoveryCursor(discoveryCursor('All cities', after), 'All cities'), after);
  } while (after);
  assert.equal(seen.length, 5207);
  assert.equal(new Set(seen).size, 5207);
  assert.deepEqual(seen, rows.map(r => r.id));
});

test('removing earlier profiles cannot shift later pages or expose newly private profiles', async () => {
  const rows = Array.from({ length: 215 }, (_, i) => profile(i + 1));
  const f = database(rows);
  const first = await service.getLiveDancerDiscovery(f.client, 'Las Vegas');
  rows.splice(0, 50);
  rows.find(r => r.id === id(105)).is_public = false;
  rows.find(r => r.id === id(106)).disabled_at = new Date().toISOString();
  rows.push({ ...profile(999), city: 'Miami' });
  const second = await service.getLiveDancerDiscovery(f.client, 'Las Vegas', first.nextAfterId);
  assert.equal(second.dancers[0].id, id(101));
  assert.ok(!second.dancers.some(r => [id(105), id(106), id(999)].includes(r.id)));
  const third = await service.getLiveDancerDiscovery(f.client, 'Las Vegas', second.nextAfterId);
  assert.equal(third.nextAfterId, null);
  assert.equal(first.dancers.length + second.dancers.length + third.dancers.length, 213);
});

test('malformed and cross-city cursors are rejected; IDs have no numeric page ceiling', () => {
  for (const value of ['bad', 'directory1:Las%20Vegas:1', `directory1:Miami:${id(10)}`, 'x'.repeat(301), `directory1:Las%20Vegas:${id(1)},id.gt.0`]) {
    assert.throws(() => parseDiscoveryCursor(value, 'Las Vegas'), /Invalid discovery cursor/);
  }
  assert.equal(parseDiscoveryCursor(null, 'Las Vegas'), null);
  assert.equal(parseDiscoveryCursor(discoveryCursor('Las Vegas', id(99999999)), 'Las Vegas'), id(99999999));
});

test('later ranking pages and newly eligible rows cannot reuse an earlier subset snapshot', async () => {
  const f = rankingFixture([row(1), row(2), row(3), row(4)]);
  const context = await f.service.discoveryContext(f.admin, f.request());
  const first = await f.service.rankPublicGrid(f.admin, context, 'Vegas', [{ id: id(1) }, { id: id(2) }], 'first');
  const second = await f.service.rankPublicGrid(f.admin, context, 'Vegas', [{ id: id(3) }, { id: id(4) }], id(2));
  assert.deepEqual(Array.from(second, r => r.id), [id(3), id(4)]);
  assert.notEqual(first[0].discovery.session, second[0].discovery.session);
  const refreshed = await f.service.rankPublicGrid(f.admin, context, 'Vegas', [{ id: id(1) }, { id: id(2) }, { id: id(3) }], 'first');
  assert.equal(refreshed.length, 3);
});
