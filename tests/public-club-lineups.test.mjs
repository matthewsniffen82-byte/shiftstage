import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { rankDiscovery } from '../src/lib/dancr/discovery-ranking.ts';

const code = ts.transpileModule(readFileSync('src/lib/dancr/public-club-lineups.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const future = new Date(Date.now() + 3600000).toISOString();
const row = (id, venueId = 'club') => ({ id: String(id), dancerId: String(id), venueId, availableUntil: future });
function fixture(candidates, { denied = [], removed = [], moved = [], fail = '' } = {}) {
  const calls = { permissions: [], portraits: [], ranked: [] };
  const deps = {
    'server-only': {},
    './directory-candidates': { getDirectoryCandidates: async () => { if (fail === 'candidates') throw new Error('offline'); return candidates; } },
    './club-media-permissions': { clubMediaPermissions: async (_admin, venueId, ids) => {
      calls.permissions.push({ venueId, ids }); if (fail === 'permissions') throw new Error('offline');
      return new Map(ids.map(id => [id, { photoIds: new Set(denied.includes(id) ? [] : ['approved']) }]));
    } },
    './discovery-ranking': { rankDiscovery },
    './performance-placement': { getPerformancePlacementScores: async (_admin, rows) => {
      if (fail === 'ranking') throw new Error('offline');
      calls.ranked = rows;
      return rows.map(row => Number(row.id));
    } },
    './public': { getLiveDancerDiscovery: async (_admin, _city, after, ids) => {
      assert.equal(after, null); calls.portraits.push([...ids]); if (fail === 'portraits') throw new Error('offline');
      return { tonightDancers: ids.filter(id => !removed.includes(id)).map(id => ({ id,
        venueId: moved.includes(id) ? 'different-club' : candidates.find(row => row.id === id).venueId })) };
    } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { assert.ok(deps[name], name); return deps[name]; } });
  return { calls, run: (venues = ['club']) => exports.getPublicClubLineups({}, 'All cities', venues) };
}

test('a club with 5207 working dancers hydrates only its five ranked portraits and keeps the complete count', async () => {
  const f = fixture(Array.from({ length: 5207 }, (_, i) => row(i + 1)));
  const result = await f.run();
  assert.equal(result.statusCounts.nowByVenue.club, 5207);
  assert.deepEqual(Array.from(result.dancers, row => row.id), ['5207', '5206', '5205', '5204', '5203']);
  assert.equal(f.calls.portraits.flat().length, 5);
  assert.ok(f.calls.permissions.every(call => call.ids.length <= 100));
  assert.ok(f.calls.ranked.every(identity => identity.venueId === 'club'));
});

test('the existing grid pin is preserved only for an eligible working dancer', async () => {
  const star = '70e50bad-b7be-45ad-bc7a-64f1cba6b5e2';
  const candidates = [...Array.from({ length: 6 }, (_, i) => row(i + 1)), row(star)];
  const allowed = await fixture(candidates).run();
  assert.equal(allowed.dancers[0].id, star);
  const denied = await fixture(candidates, { denied: [star] }).run();
  assert.ok(denied.dancers.every(row => row.id !== star));
  assert.equal(denied.dancers[0].id, '6');
});

test('every club gets its own top five while off-shift and unapproved club media never enter the previews', async () => {
  const f = fixture([...Array.from({ length: 12 }, (_, i) => row(i + 1, i < 6 ? 'a' : 'b')),
    { ...row(99, 'a'), availableUntil: '2000-01-01T00:00:00Z' }, row(100, 'not-listed')], { denied: ['6'] });
  const result = await f.run(['a', 'b', 'empty']);
  assert.equal(result.statusCounts.nowByVenue.a, 5); assert.equal(result.statusCounts.nowByVenue.b, 6);
  assert.equal(result.statusCounts.nowByVenue.empty, 0); assert.equal(result.statusCounts.not_now, 1);
  assert.deepEqual(Array.from(result.dancers, row => row.id), ['5', '4', '3', '2', '1', '12', '11', '10', '9', '8']);
  assert.equal(f.calls.portraits.flat().length, 10);
  assert.ok(f.calls.ranked.every(row => !['6', '99', '100'].includes(row.dancerId)));
});

test('profiles revoked, checked out or moved during hydration are removed and backfilled without changing ranking', async () => {
  const f = fixture(Array.from({ length: 9 }, (_, i) => row(i + 1)), { removed: ['9'], moved: ['8'] });
  const result = await f.run();
  assert.deepEqual(Array.from(result.dancers, row => row.id), ['7', '6', '5', '4', '3']);
  assert.equal(result.statusCounts.nowByVenue.club, 7);
  assert.equal(f.calls.portraits.length, 2); assert.equal(f.calls.portraits.flat().length, 7);
});

test('verified empty clubs need no portrait requests and backend failures never become zero counts', async () => {
  const f = fixture([]); const result = await f.run();
  assert.equal(result.statusCounts.nowByVenue.club, 0); assert.equal(f.calls.portraits.length, 0);
  for (const fail of ['candidates', 'permissions', 'ranking', 'portraits']) {
    await assert.rejects(fixture([row(1)], { fail }).run(), /offline/);
  }
});
