import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('weekly report counts only recent published TV and distinct gallery photos approved for this club', async () => {
  const db = new PGlite();
  const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12,'0');
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table dancer_profiles(id uuid primary key,stage_name text,status text,verification_status text,is_public bool,disabled_at timestamptz);
      create table venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text);
      create table dancer_photos(id uuid,dancer_id uuid,review_status text,created_at timestamptz,retention_removed_at timestamptz);
      create table mydancr_tv_videos(id uuid,dancer_id uuid,status text,published_at timestamptz,expires_at timestamptz,
        duration_seconds int,retention_removed_at timestamptz,distribution_scope text);
      create table inventory(venue uuid, dancer uuid, photo uuid);
      create function club_approved_media(uuid,uuid[]) returns jsonb language sql as $$
        select coalesce(jsonb_agg(jsonb_build_object('dancerId',dancer,'photoId',photo)),'[]') from public.inventory where venue=$1 and dancer=any($2) $$;
      create function get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) returns jsonb language sql as $$
        select jsonb_build_object('automatic',42,'performance',jsonb_build_object('dancers',jsonb_build_array(
          jsonb_build_object('id','${id(2)}','name','Activity','internal',jsonb_build_object('requests',3),'vip','{}'::jsonb,'external','{}'::jsonb)))) $$;
      insert into dancer_profiles values ('${id(1)}','Media only','approved','approved',true,null),
        ('${id(2)}','Activity','approved','approved',true,null), ('${id(3)}','Other club','approved','approved',true,null);
      insert into venue_dancer_affiliations values ('${id(10)}','${id(1)}','active'),('${id(11)}','${id(3)}','active');
      insert into dancer_photos select md5(i::text)::uuid,'${id(1)}',case when i=4 then 'rejected' else 'approved' end,
        case i when 2 then timestamptz '2026-11-01' - interval '1 ms' when 3 then timestamptz '2026-11-08' else timestamptz '2026-11-01' end,
        case when i=6 then now() end from generate_series(1,6) i;
      insert into inventory select '${id(10)}','${id(1)}',id from dancer_photos where id<>md5('5')::uuid;
      insert into inventory values ('${id(10)}','${id(1)}',md5('1')::uuid),('${id(10)}','${id(1)}',null);
      insert into mydancr_tv_videos select md5(i::text)::uuid,case when i=9 then '${id(3)}' else '${id(1)}' end::uuid,
        case when i=4 then 'pending' else 'approved' end,
        case i when 2 then timestamptz '2026-10-31' when 3 then timestamptz '2026-11-08' else timestamptz '2026-11-01' end,
        case when i=5 then timestamptz '2026-11-08' end,case when i=6 then 31 else 15 end,case when i=7 then now() end,
        case when i=8 then 'feed_only' else 'profile_and_feed' end from generate_series(1,9) i;
    `);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    const file = readdirSync(dir).find(name => name.endsWith('_weekly_dancer_media_scores.sql'));
    await db.exec(readFileSync(new URL(file,dir),'utf8'));
    const { rows: [{ report }] } = await db.query("select get_venue_performance_analytics($1,'2026-11-01','2026-11-08','2026-11-07','2026-11-08') report",[id(10)]);
    assert.equal(report.automatic,42);
    assert.deepEqual(report.performance.dancers.map(d=>[d.id,d.media]), [[id(2),{photos:0,videos:0}],[id(1),{photos:1,videos:2}]]);
    assert.equal(report.performance.dancers[0].internal.requests,3);
    for (const role of ['anon','authenticated','service_role']) {
      const acl=await db.query("select has_function_privilege($1,'get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','execute') allowed",[role]);
      assert.equal(acl.rows[0].allowed,role==='service_role');
    }
  } finally { await db.close(); }
});
