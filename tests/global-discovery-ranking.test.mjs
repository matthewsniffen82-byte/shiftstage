import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, compile, row, id } from './helpers/discovery-fixture.mjs';
import * as pagination from '../src/lib/dancr/discovery-pagination.ts';

function directoryFixture(candidates) {
  const f = fixture(candidates), hidden = new Set(), cardReads = [];
  const directory = compile('src/lib/dancr/public-directory.ts', {
    'server-only': {}, 'node:crypto': { randomUUID }, './discovery-service': f.service,
    './discovery-pagination': pagination,
    './public': { getLiveDancerDiscovery: async (_admin, city, after, ids) => {
      assert.equal(after, null); assert.ok(ids.length <= 100); cardReads.push([...ids]);
      const dancers = candidates.filter(r => ids.includes(r.id) && !hidden.has(r.id) && (city === 'All cities' || r.city === city))
        .map(r => ({ id: r.id, venueId: r.venueId }));
      return { dancers, tonightDancers: dancers.filter(r => Date.parse(candidates.find(c => c.id === r.id).availableUntil) > Date.now()) };
    } },
  });
  return { ...f, hidden, cardReads, directory };
}

test('Star stays first before pagination, with no duplicates and normal eligibility filters', async () => {
  const starId = '70e50bad-b7be-45ad-bc7a-64f1cba6b5e2';
  const star = row(300, { id: starId, dancerId: starId, performanceScore: 0,
    availableUntil: new Date(Date.now() + 3600000).toISOString(), venueId: id(8000) });
  const others = Array.from({ length: 210 }, (_, i) => row(i + 1, { performanceScore: 210 - i }));
  const f = directoryFixture([...others, star]);
  const first = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas' });
  assert.equal(first.dancers[0].id, starId);
  assert.equal(first.dancers[0].discovery.position, 0);
  assert.deepEqual(f.cardReads[0], [starId, ...others.slice(0, 23).map(r => r.id)]);
  const seen = Array.from(first.dancers, r => r.id);
  let cursor = pagination.parseDiscoveryCursor(first.nextCursor, 'Vegas');
  do {
    const page = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', cursor });
    seen.push(...page.dancers.map(r => r.id));
    cursor = pagination.parseDiscoveryCursor(page.nextCursor, 'Vegas');
  } while (cursor);
  assert.deepEqual(seen, [starId, ...others.map(r => r.id)]);
  for (const options of [{ city: 'Miami' }, { filter: 'not_now' }, { venueId: id(8001) }]) {
    const page = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', ...options });
    assert.ok(page.dancers.every(r => r.id !== starId));
  }
  f.hidden.add(starId);
  const hidden = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas' });
  assert.equal(hidden.dancers[0].id, others[0].id);
  assert.equal(hidden.dancers.length, 24);
  assert.ok(hidden.dancers.every(r => r.id !== starId));
});

test('the directory ranks all 5,207 dancers before fetching 24 opening cards and larger continuations', async () => {
  const candidates = Array.from({ length: 5207 }, (_, i) => row(i + 1, { performanceScore: i }));
  const f = directoryFixture(candidates), seen = [];
  let cursor = '';
  do {
    const page = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', cursor });
    if (!cursor) {
      assert.deepEqual(Array.from(page.dancers.slice(0, 10), r => r.id), candidates.slice(-10).reverse().map(r => r.id));
      assert.equal(f.cardReads.length, 1);
      assert.equal(page.dancers.length, 24);
      assert.equal(f.cardReads[0].length, 24);
      candidates[0].performanceScore = 999999;
    } else {
      assert.equal(page.dancers.length, Math.min(100, candidates.length - seen.length));
    }
    assert.deepEqual(Array.from(page.dancers, r => r.discovery.position),
      Array.from({ length: page.dancers.length }, (_, i) => seen.length + i));
    seen.push(...page.dancers.map(r => r.id));
    cursor = pagination.parseDiscoveryCursor(page.nextCursor, 'Vegas');
  } while (cursor);
  assert.deepEqual(seen, candidates.slice().reverse().map(r => r.id));
  assert.equal(new Set(seen).size, 5207);
  assert.equal(f.calls.filter(([name]) => name === 'get_public_directory_candidates').length, 7);
  const nextVisit = await f.directory.getRankedDirectoryPage(f.admin, f.request(id(50), id(52)), { city: 'Vegas' });
  assert.equal(nextVisit.dancers[0].id, id(1));
  assert.doesNotMatch(JSON.stringify(nextVisit.dancers), /performanceScore|buckets/);
});

test('working status and club filters find top matches beyond the first global page', async () => {
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const candidates = Array.from({ length: 1200 }, (_, i) => row(i + 1, {
    performanceScore: i < 1100 ? 100 : i - 1100,
    availableUntil: i >= 1100 ? expiry : null, venueId: i >= 1100 ? id(8000) : null,
  }));
  const f = directoryFixture(candidates);
  const working = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', filter: 'now', venueId: id(8000) });
  assert.equal(working.dancers.length, 24); assert.equal(working.dancers[0].id, id(1200));
  const continuation = await f.directory.getRankedDirectoryPage(f.admin, f.request(), {
    city: 'Vegas', filter: 'now', venueId: id(8000), cursor: pagination.parseDiscoveryCursor(working.nextCursor, 'Vegas'),
  });
  assert.equal(continuation.dancers.length, 76);
  assert.equal(continuation.nextCursor, null);
  assert.deepEqual([...working.dancers, ...continuation.dancers].map(r => r.id),
    candidates.slice(1100).reverse().map(r => r.id));
  const inactive = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', filter: 'not_now' });
  assert.equal(inactive.dancers[0].id, id(1));
  assert.ok(inactive.dancers.every(r => !r.venueId));
});

test('status totals include both filters, refresh with presence, and respect city and club scope', async () => {
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const candidates = [
    row(1, { availableUntil: expiry, venueId: id(8000) }),
    row(2), row(3, { availableUntil: new Date(Date.now() - 1000).toISOString() }),
    row(4, { city: 'Miami', availableUntil: expiry, venueId: id(8001) }),
  ];
  const f = directoryFixture(candidates);
  const totals = async options => {
    const page = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', ...options });
    return { ...page.statusCounts };
  };
  for (const filter of ['now', 'not_now', 'all']) {
    assert.deepEqual(await totals({ filter }), { now: 1, not_now: 2 });
  }
  assert.deepEqual(await totals({ city: 'All cities' }), { now: 2, not_now: 2 });
  assert.deepEqual(await totals({ filter: 'now', venueId: id(8000) }), { now: 1, not_now: 0 });
  candidates[0].availableUntil = null;
  assert.deepEqual(await totals({ filter: 'now' }), { now: 0, not_now: 3 }, 'reused rankings still refresh status totals');
  candidates.splice(1, 1);
  assert.deepEqual(await totals({ filter: 'now' }), { now: 0, not_now: 2 }, 'removed public candidates leave both totals');
  assert.deepEqual(await totals({ city: 'Empty city' }), { now: 0, not_now: 0 });
});

test('later visibility revocation is rechecked and backfilled without duplicates', async () => {
  const candidates = Array.from({ length: 220 }, (_, i) => row(i + 1, { performanceScore: 220 - i }));
  const f = directoryFixture(candidates);
  const first = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas' });
  for (let i = 1; i <= 110; i++) f.hidden.add(id(i));
  const next = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', cursor: pagination.parseDiscoveryCursor(first.nextCursor, 'Vegas') });
  assert.equal(next.dancers.length, 100); assert.equal(next.dancers[0].id, id(111));
  assert.equal(next.dancers.at(-1).id, id(210)); assert.ok(next.nextCursor.endsWith(':210'));
});

test('directory continuations are bound to visitor, city, status, club, and expiry', async () => {
  const f = directoryFixture(Array.from({ length: 110 }, (_, i) => row(i + 1)));
  const first = await f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas' });
  const cursor = pagination.parseDiscoveryCursor(first.nextCursor, 'Vegas');
  for (const [request, options] of [[f.request(id(88)), {}], [f.request(), { city: 'Miami' }], [f.request(), { filter: 'now' }], [f.request(), { venueId: id(8000) }]]) {
    await assert.rejects(f.directory.getRankedDirectoryPage(f.admin, request, { city: 'Vegas', cursor, ...options }), /expired/);
  }
  f.data.discovery_sessions[0].expires_at = new Date(Date.now() - 1).toISOString();
  await assert.rejects(f.directory.getRankedDirectoryPage(f.admin, f.request(), { city: 'Vegas', cursor }), /expired/);
});

test('anonymous directory readers get a private cookie and the same ranked continuation', async () => {
  const f = directoryFixture(Array.from({ length: 110 }, (_, i) => row(i + 1, { performanceScore: i })));
  const first = await f.directory.getRankedDirectoryPage(f.admin, new Request('https://example.test'), { city: 'Vegas' });
  assert.match(first.cookie, /HttpOnly; SameSite=Lax; Secure/);
  const next = await f.directory.getRankedDirectoryPage(f.admin, new Request('https://example.test', { headers: { cookie: first.cookie.split(';')[0] } }), {
    city: 'Vegas', cursor: pagination.parseDiscoveryCursor(first.nextCursor, 'Vegas'),
  });
  assert.equal(first.dancers[0].id, id(110)); assert.equal(next.dancers[0].id, id(86));
  assert.equal(next.dancers.length, 86);
  assert.equal(next.nextCursor, null);
});

test('MyDancrTV ranks beyond 800 dancers and 5,000 videos before its first page and reaches the end', async () => {
  const candidates = Array.from({ length: 5207 }, (_, i) => row(i + 1, { performanceScore: i }));
  const f = fixture(candidates), context = await f.service.discoveryContext(f.admin, f.request());
  const tv = compile('src/lib/dancr/discovery-tv.ts', { './discovery-service': f.service, './tv': {
    getPublicMyDancrTvFeed: async (_admin, options) => options.candidateVideoIds.map(id => ({ id, dancer: { id } })).reverse(),
  } });
  const seen = []; let cursor = '';
  do {
    const page = await tv.getRankedTvPage(f.admin, context, { city: 'Vegas', filter: 'for-you', limit: 24, cursor });
    if (!cursor) { assert.equal(page.videos[0].id, id(5207)); candidates[0].performanceScore = 999999; }
    seen.push(...page.videos.map(r => r.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, candidates.slice().reverse().map(r => r.id));
  assert.equal(new Set(seen).size, 5207);
  assert.equal(f.calls.filter(([name]) => name === 'get_public_tv_ranking_candidates').length, 7);
});

test('TV following includes accounts past the first 1,000 follows', async () => {
  const candidates = Array.from({ length: 1205 }, (_, i) => row(i + 1, { performanceScore: i }));
  const f = fixture(candidates), context = await f.service.discoveryContext(f.admin, f.request(id(50), id(51), 'valid'));
  f.data.follows.push(...candidates.map(r => ({ customer_id: id(99), dancer_id: r.id })));
  const { snapshot } = await f.service.discoverySnapshot(f.admin, context, { surface: 'tv', city: 'Vegas', filter: 'following' });
  assert.equal(snapshot.ordered_ids.length, 1205); assert.equal(snapshot.ordered_ids[0], id(1205));
});

test('candidate failures and nonadvancing pages fail without saving a partial ranking', async () => {
  for (const failure of ['error', 'repeat']) {
    const f = fixture([row(1)]), context = await f.service.discoveryContext(f.admin, f.request());
    f.admin.rpc = async () => failure === 'error' ? { error: new Error('unavailable'), data: null } : { data: [row(1)], error: null };
    await assert.rejects(f.service.discoverySnapshot(f.admin, context, { surface: 'grid', city: 'Vegas', directory: true }));
    assert.equal(f.data.discovery_sessions.length, 0);
  }
});
