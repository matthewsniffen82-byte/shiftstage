import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('uncapped ranking migration preserves eligibility and keeps candidate RPCs service-only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table discovery_sessions (surface text, ordered_ids uuid[] constraint discovery_sessions_ordered_ids_check check(cardinality(ordered_ids)<=5000));
      create table discovery_events (position integer constraint discovery_events_position_check check(position between 0 and 4999));
      create table dancer_profiles (id uuid primary key, city text, status text, verification_status text, is_public boolean, disabled_at timestamptz);
      create table venues (id uuid primary key, is_active boolean, has_active_club_deal boolean);
      create function has_active_club_deal(v venues) returns boolean language sql as $$ select v.has_active_club_deal $$;
      create table shifts (id uuid primary key, dancer_id uuid, venue_id uuid, status text, checked_in_at timestamptz, checked_out_at timestamptz,
        location_status text, location_verification_expires_at timestamptz, starts_at timestamptz, ends_at timestamptz);
      create table mydancr_tv_videos (id uuid primary key, dancer_id uuid, status text, duration_seconds numeric, published_at timestamptz, expires_at timestamptz);
      insert into dancer_profiles select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'Vegas', 'approved', 'approved', true, null from generate_series(1,5207) n;
      insert into mydancr_tv_videos select id,id,'approved',20,now()-interval '1 day',null from dancer_profiles;
      insert into venues values ('93000000-0000-4000-8000-000000000001',true,true);
      insert into shifts select id,id,'93000000-0000-4000-8000-000000000001','posted',now(),null,'club_confirmed',now()+interval '1 hour',now(),now()+interval '2 hours' from dancer_profiles where id::text like '%005207';
    `);
    await db.exec(readFileSync('supabase/migrations/20261016000448_global_discovery_ranking.sql', 'utf8'));
    for (const name of ['get_public_directory_candidates', 'get_public_tv_ranking_candidates']) {
      const seen = []; let after = null;
      for (;;) {
        const { rows } = await db.query('select ' + name + '($1,$2) as data', ['Vegas', after]);
        const page = rows[0].data;
        assert.ok(page.length <= 1000);
        if (!page.length) break;
        seen.push(...page.map(r => r.id)); after = page.at(-1).id;
      }
      assert.equal(seen.length, 5207); assert.equal(new Set(seen).size, 5207);
      const otherCity = await db.query('select ' + name + '($1,null) as data', ['Miami']);
      assert.deepEqual(otherCity.rows[0].data, []);
    }
    await db.exec(`
      insert into discovery_sessions select 'grid',array_agg(id) from dancer_profiles;
      insert into discovery_sessions select 'tv',array_agg(id) from dancer_profiles;
      insert into discovery_events values (5206);
      update dancer_profiles set is_public=false where id::text like '%000001';
      update dancer_profiles set verification_status='pending' where id::text like '%000002';
      update dancer_profiles set disabled_at=now() where id::text like '%000003';
      update mydancr_tv_videos set status='rejected' where id::text like '%000004';
      update mydancr_tv_videos set expires_at=now()-interval '1 second' where id::text like '%000005';
      update mydancr_tv_videos set published_at=now()+interval '1 day' where id::text like '%000006';
      update mydancr_tv_videos set duration_seconds=31 where id::text like '%000007';
    `);
    const directory = (await db.query("select get_public_directory_candidates('Vegas',null) data")).rows[0].data;
    assert.ok(directory.every(r => Number(r.id.slice(-12)) > 3));
    const tv = (await db.query("select get_public_tv_ranking_candidates('Vegas',null,null) data")).rows[0].data;
    assert.ok(tv.every(r => Number(r.id.slice(-12)) > 7));
    const club = (await db.query("select get_public_tv_ranking_candidates('Vegas',null,'93000000-0000-4000-8000-000000000001') data")).rows[0].data;
    assert.equal(club.length, 1); assert.ok(club[0].id.endsWith('005207'));
    await db.exec('update shifts set checked_out_at=now()');
    assert.deepEqual((await db.query("select get_public_tv_ranking_candidates('Vegas',null,'93000000-0000-4000-8000-000000000001') data")).rows[0].data, []);
    const privileges = await db.query(`select proname,prosecdef,
      has_function_privilege('anon',oid,'execute') anon,
      has_function_privilege('authenticated',oid,'execute') authenticated,
      has_function_privilege('service_role',oid,'execute') service
      from pg_proc where proname in ('get_public_directory_candidates','get_public_tv_ranking_candidates')`);
    assert.equal(privileges.rows.length, 2);
    for (const p of privileges.rows) { assert.equal(p.prosecdef, false); assert.equal(p.anon, false); assert.equal(p.authenticated, false); assert.equal(p.service, true); }
  } finally { await db.close(); }
});
