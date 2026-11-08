import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('src/lib/dancr/club-approval-queue.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const profile = id => ({ user_id: id, stage_name: 'Demo', city: 'Las Vegas' });
const join = (id, status = 'pending') => ({ dancer_id: id, status, revision: 'revision', requested_at: '2026-11-01', dancer_profiles: profile(id) });
const batch = (id, count) => ({ dancer_id: id, stage_name: 'Demo', created_at: '2026-11-02', item_count: count });

function fixture({ joins = [], batches = [], expired = [], failure } = {}) {
  const signed = [], ranges = [], enrollments = [], module = {};
  const db = {
    async rpc(name, args) {
      assert.equal(name, 'get_media_batches'); assert.equal(args.p_venue, 'club'); assert.equal(args.p_actor, 'owner'); assert.equal(args.p_role, 'venue');
      return { data: { batches: batches.slice(0, 100) }, error: failure };
    },
    from(table) {
      const filters = {};
      const q = {
        select() { return q; }, is() { return q; }, order() { return q; },
        eq(key, val) { filters[key] = val; return q; }, in(key, val) { filters[key] = val; return q; },
        gt(key, value) { filters.after = value; filters.column = key; return q; },
        async limit(size) {
          assert.equal(filters.venue_id, 'club');
          ranges.push({ table, after: filters.after, size });
          if (table === 'club_dancer_approvals') {
            assert.deepEqual([...filters['dancer_profiles.status']], ['pending_review', 'approved']);
            if (filters.after) assert.equal(filters.column, 'dancer_id');
            return { data: joins.filter(row => filters.status.includes(row.status) && (!filters.after || row.dancer_id > filters.after)).slice(0, size) };
          }
          assert.equal(table, 'dancer_media_batches'); assert.equal(filters.state, 'club');
          if (filters.after) assert.equal(filters.column, 'id');
          return { data: batches.map((b,i) => ({ ...b, id: String(i).padStart(5,'0'), items: Array(b.item_count), dancer_profiles: profile(b.dancer_id) }))
            .filter(row => !filters.after || row.id > filters.after).slice(0, size) };
        },
        async maybeSingle() {
          assert.equal(table, 'dancer_nfc_enrollments'); assert.equal(filters.venue_id, 'club');
          enrollments.push(filters.dancer_user_id);
          return { data: expired.includes(filters.dancer_user_id) ? null : { expires_at: '2099-01-01', nfc_tags: { status: 'active' } } };
        },
      };
      return q;
    },
  };
  vm.runInNewContext(source, { exports: module, require: name => {
    assert.equal(name, './media-review-main-photo');
    return { mainPhotoPreviews: async (_db, ids) => { signed.push(...ids); return new Map(ids.map(id => [id, '/private/' + id])); } };
  } });
  return { load: (offset = 0, countOnly = false) => module.clubApprovalQueue(db, 'owner', 'club', offset, countOnly), signed, ranges, enrollments };
}

test('one new dancer and six submitted photos/videos produce one card and one badge', async () => {
  const f = fixture({ joins: [join('d')], batches: [batch('d', 4), batch('d', 2)] });
  const count = await f.load(0, true);
  assert.equal(count.count, 1); assert.equal(count.requests, undefined);
  assert.deepEqual(f.signed, []); assert.deepEqual(f.enrollments, []);
  const page = await f.load();
  assert.equal(page.count, 1); assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].mediaCount, 6); assert.equal(page.requests[0].status, 'pending');
  assert.equal(page.requests[0].revision, 'revision'); assert.deepEqual(f.signed, ['d']);
});

test('same-name dancers stay separate, expired previews stay private, and declined history adds no badge', async () => {
  const f = fixture({ joins: [join('new'), join('past', 'rejected')], batches: [batch('existing', 2)], expired: ['new'] });
  const page = await f.load();
  assert.equal(page.count, 2); assert.equal((await f.load(0, true)).count, 2);
  assert.deepEqual(Array.from(page.requests, r => r.dancerId), ['new','existing','past']);
  assert.equal(page.requests[0].avatarUrl, null); assert.equal(page.requests[0].expired, true);
  assert.equal(page.requests[1].status, 'media'); assert.equal(page.requests[1].revision, null);
  assert.equal(page.requests[2].status, 'rejected');
});

test('counting precedes pagination and covers queues beyond the batch picker limit', async () => {
  const joins = Array.from({ length: 252 }, (_, i) => join('d' + String(i).padStart(3, '0')));
  const batches = Array.from({ length: 103 }, (_, i) => batch(i < 100 ? joins[i].dancer_id : 'extra' + i, 2));
  const f = fixture({ joins, batches });
  const page = await f.load(250);
  assert.equal(page.count, 255); assert.equal(page.requests.length, 5); assert.equal(page.hasMore, false);
  assert.equal(f.signed.length, 5);
  assert.ok(f.ranges.some(x => x.table === 'dancer_media_batches' && x.after === '00099'));
  assert.ok(f.ranges.some(x => x.table === 'club_dancer_approvals' && x.after === 'd249'));
});

test('retained media for a declined request adds no badge or active review',async()=>{
 const f=fixture({joins:[join('a','rejected')],batches:[batch('a',3)]});
 const queue=await f.load();
 assert.equal(queue.count,0);
 assert.equal(queue.requests[0].mediaCount,0);
});
test('a failed media read cannot publish a partial count', async () => {
  await assert.rejects(fixture({ joins: [join('new')], failure: Error('Unavailable') }).load(0, true), /Unavailable/);
});
