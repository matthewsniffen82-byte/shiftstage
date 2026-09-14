import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/lib/dancr/tv.ts', 'utf8');
const ast = ts.createSourceFile('tv.ts', source, ts.ScriptTarget.Latest, true);
const names = ['parseTvFeedCursor', 'getPublicMyDancrTvFeed', 'publicTvRowsQuery'];
const code = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.body && names.includes(node.name?.text))
  .map(node => node.getText(ast)).join('\n');
const uuid = index => `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const timestamp = '2026-09-01T01:00:00.123456+00:00';

function fixture(count, excluded = new Set()) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: uuid(count - i), published_at: timestamp, publishedAt: timestamp,
    dancer: { id: uuid(count - i), city: 'Vegas' },
  }));
  const queries = [];
  const admin = { from() {
    const operations = []; queries.push(operations);
    const query = new Proxy({}, { get(_, name) {
      if (name === 'then') return resolve => {
        let data = rows;
        const selected = operations.find(([method, key]) => method === 'eq' && key === 'id');
        if (selected) return resolve({ data: rows.find(row => row.id === selected[2]), error: null });
        const boundary = operations.find(([method, value]) => method === 'or' && value.startsWith('published_at.lt.'));
        if (boundary) data = data.filter(row => row.id < boundary[1].match(/id\.lt\.([a-f0-9-]+)/)[1]);
        const limit = operations.find(([method]) => method === 'limit')[1];
        return resolve({ data: data.slice(0, limit), error: null });
      };
      return (...args) => { operations.push([name, ...args]); return query; };
    } });
    return query;
  } };
  const context = vm.createContext({ exports: {}, Date, Map, Set,
    UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    PUBLIC_TV_SELECT: 'public projection', MYDANCR_TV_MAX_DURATION_SECONDS: 30, MYDANCR_TV_PROFILE_VIDEO_LIMIT: 50,
    MYDANCR_TV_FILTERS: new Set(['for-you']), normalizeTvCity: city => city,
    tvCitiesMatch: (a,b) => a === b,
    normalizeFeedRow: row => row && !excluded.has(row.id) ? row : null,
    getPublicTvShiftContexts: async () => new Map(), applyPublicTvShiftContext: row => row,
    // Real diversification reorders a page; deliberately reverse each batch to
    // prove that the cursor follows the query, not the last displayed video.
    diversifyFeed: rows => [...rows].reverse(), prioritizeMyDancrTvVenue: rows => rows,
    signPublicVideos: async (_, rows) => rows, getActiveClubDealListsForVenues: async () => new Map(),
    toPublicClubDeal: deal => deal,
  });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { ...context.exports, admin, queries };
}

test('small keyset pages reach beyond the former 120-row ceiling without repeats or skipped timestamp ties', async () => {
  const f = fixture(145), ids = [], cursors = [];
  let cursor;
  do {
    const page = await f.getPublicMyDancrTvFeed(f.admin, { city: 'Vegas', limit: 24, page: { cursor } });
    assert.ok(page.videos.length <= 24);
    ids.push(...page.videos.map(row => row.id)); cursor = page.nextCursor; cursors.push(cursor);
  } while (cursor);
  assert.equal(ids.length, 145); assert.equal(new Set(ids).size, 145);
  assert.equal(cursors.length, 7);
  assert.ok(cursors[0].startsWith(timestamp + '|'), 'keep database microsecond precision');
  for (const operations of f.queries) {
    assert.ok(operations.some(([name,key,value]) => name === 'eq' && key === 'dancer_profiles.is_public' && value === true));
    assert.deepEqual(Array.from(operations.filter(([name]) => name === 'order'), op => op[1]), ['published_at', 'id']);
  }
});

test('a page removed by visibility checks still advances; a selected deep link does not drop a candidate', async () => {
  const f = fixture(49, new Set(Array.from({ length: 24 }, (_, i) => uuid(49-i))));
  const first = await f.getPublicMyDancrTvFeed(f.admin, { city: 'Vegas', limit: 24, page: {} });
  assert.equal(first.videos.length, 0); assert.ok(first.nextCursor);
  const second = await f.getPublicMyDancrTvFeed(f.admin, { city: 'Vegas', limit: 24, page: { cursor: first.nextCursor } });
  assert.equal(second.videos.length, 24);
  const selected = fixture(49);
  const page = await selected.getPublicMyDancrTvFeed(selected.admin, { city: 'Vegas', limit: 24, selectedVideoId: uuid(1), page: {} });
  assert.equal(page.videos.length, 25); assert.ok(page.videos.some(row => row.id === uuid(1)));
});

test('legacy readers keep their array contract and malformed cursors cannot reach the database', async () => {
  const f = fixture(5);
  assert.ok(Array.isArray(await f.getPublicMyDancrTvFeed(f.admin, { city: 'Vegas', limit: 3 })));
  const count = f.queries.length;
  for (const cursor of ['bad', timestamp+'|'+uuid(1)+'|extra', 'x),status.eq.hidden|'+uuid(1)]) {
    assert.equal(f.parseTvFeedCursor(cursor), null);
    await assert.rejects(f.getPublicMyDancrTvFeed(f.admin, { page: { cursor } }), /Invalid TV cursor/);
  }
  assert.equal(f.queries.length, count);
});

test('HTTP pagination is opt-in, rejects malformed cursors, and leaves dancer readers unchanged', async () => {
  const calls = [], exports = {}, cursor = timestamp + '|' + uuid(1);
  const deps = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/src/lib/api': { apiError: error => { throw error; } },
    '@/src/lib/dancr/tv': { MYDANCR_TV_FILTERS: new Set(['for-you']), parseTvFeedCursor: fixture(0).parseTvFeedCursor,
      getPublicMyDancrTvFeed: async (_, options) => { calls.push(options); return options.page ? { videos: [], nextCursor: null } : []; } },
    '@/src/lib/dancr/media-limits': { MAX_DANCER_PROFILE_VIDEOS: 50 },
    '@/src/lib/dancr/public-cache-policy': { publicTvCacheControl: () => 'public, max-age=0' },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
    '@/src/lib/supabase/request': { getBearerToken: () => null },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('app/api/public/tv/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, performance, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  const get = query => exports.GET(new Request('https://example.test/api/public/tv?' + query));
  assert.equal((await get('paging=1&cursor=bad')).status, 400); assert.equal(calls.length, 0);
  const body = await (await get('paging=1&video='+uuid(2)+'&cursor='+encodeURIComponent(cursor))).json();
  assert.equal(body.nextCursor, null); assert.equal(calls[0].page.cursor, cursor);
  assert.equal(calls[0].selectedVideoId, undefined, 'do not reinsert the deep link on every page');
  const dancer = await (await get('paging=1&dancer='+uuid(3))).json();
  assert.equal(calls[1].page, undefined); assert.equal('nextCursor' in dancer, false);
});
