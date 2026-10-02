import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';
import { DEMO_GRIDS, DEMO_NAMES, gridPhoto, photoStoragePaths, publishSql, sqlText, demoRosterSql } from '../scripts/lib/echo-demo-grid.mjs';

test('clones only the actual grid-facing approved photo and its existing sizes', () => {
  const primary = {id:'a',review_status:'approved',is_primary:true,sort_order:0};
  const pinned = {id:'b',review_status:'approved',is_pinned:true,sort_order:2};
  assert.equal(gridPhoto({dancer_photos:[primary,pinned,{id:'c',is_pinned:true,review_status:'rejected'}]}),pinned);
  assert.deepEqual(photoStoragePaths('owner/profile/card.r320-480-640.m900x1200.f50x45.jpg'),[
    'owner/profile/card.r320-480-640.m900x1200.f50x45.jpg',
    ...[320,480,640].map(w=>`owner/profile/card.r320-480-640.m900x1200.f50x45.jpg.w${w}.webp`),
  ]);
  assert.throws(()=>photoStoragePaths('../someone/photo.jpg'));
  assert.equal(new Set(DEMO_NAMES).size,DEMO_NAMES.length);
  assert.ok(DEMO_NAMES.length>=100);
  assert.equal(sqlText("O'Neil"),"'O''Neil'");
});

for (const grid of DEMO_GRIDS) test(`publishes exactly ${grid.target} scoped ${grid.name} demo roster members without changing the original profile`, async () => {
  const venueId = grid.venueId, marker = grid.marker;
  const additions = grid.target - 1;
  const pg=await createInternalRosterDatabase();
  try {
    await pg.exec(`alter table auth.users add column email text, add column raw_user_meta_data jsonb, add column banned_until timestamptz;
      create table public.dancer_age_verification_settings(singleton boolean primary key,enabled boolean);
      insert into public.dancer_age_verification_settings values(true,false);
      create table public.mydancr_tv_videos(id uuid primary key,dancer_id uuid);
      alter table public.venue_dancer_affiliations add column reentry_blocked boolean not null default false;`);
    for(const file of ['20260929100000_internal_demo_roster.sql','20260929130000_star_internal_demo.sql','20260929120000_internal_main_photos.sql','20261001235000_echo_demo_grid.sql','20261002010000_additional_venue_demo_grids.sql']) {
      await pg.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    }
    await pg.query('insert into auth.users(id) values($1)',[id(8)]);
    await pg.query("insert into public.app_users(id,role,account_state) values($1,'venue','active')",[id(8)]);
    await pg.query("insert into public.venues(id,name,slug,city,owner_user_id,is_active,timezone) values($1,$3,$4,'Las Vegas',$2,true,'America/Los_Angeles')",[venueId,id(8),grid.name,grid.key]);
    await pg.query("insert into public.nfc_tags(id,venue_id,tag_type,label,token_digest,status) values($1,$2,'dressing_room','Test',repeat('c',64),'active')",[id(35),venueId]);
    await pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5)',[id(35),id(1),id(50),'both',{}]);
    const original=(await pg.query('select to_jsonb(d) value from public.dancer_profiles d where id=$1',[id(10)])).rows[0].value;
    const plan={venueId:venueId,target:grid.target,baseIds:[id(10)],profiles:[]};
    for(let i=1;i<=additions;i++) {
      const user=id(1000+i),dancer=id(2000+i),slug=`${grid.key}-grid-${String(i).padStart(3,'0')}`;
      await pg.query("insert into auth.users(id,email,raw_user_meta_data,banned_until) values($1,$2,$3,now()+interval '100 years')",[user,slug+'@synthetic.mydancr.invalid',{dataset_marker:marker}]);
      await pg.query("insert into public.app_users(id,role,account_state) values($1,'dancer','active')",[user]);
      await pg.query("insert into public.dancer_profiles(id,user_id,real_name,stage_name,slug,city,status,verification_status,is_public) values($1,$2,'Demo',$3,$4,'Las Vegas','draft','pending',false)",[dancer,user,DEMO_NAMES[i-1],slug]);
      plan.profiles.push({user_id:user,dancer_id:dancer,slug,name:DEMO_NAMES[i-1],storage_path:`${user}/${dancer}/${marker}/card.jpg`,photo_id:id(3000+i),shift_id:id(4000+i),source_photo_id:id(110)});
    }
    await pg.exec(publishSql(plan));
    const roster=async()=> (await pg.query('select * from public.internal_roster_members($1)',[venueId])).rows;
    assert.equal((await roster()).length,grid.target);
    assert.equal((await pg.query(`select count(*)::int n from public.dancer_photos where dancer_id in(select id from public.dancer_profiles where slug like '${grid.key}-grid-%')`)).rows[0].n,additions);
    assert.equal((await pg.query('select count(*)::int n from public.mydancr_tv_videos')).rows[0].n,0);
    assert.deepEqual((await pg.query('select to_jsonb(d) value from public.dancer_profiles d where id=$1',[id(10)])).rows[0].value,original);
    await pg.exec(publishSql(plan));
    assert.equal((await roster()).length,grid.target,'Replaying the same publication does not duplicate profiles or shifts');
    for(const sql of [
      "update auth.users set banned_until=null where id='"+id(1001)+"'",
      "update auth.users set raw_user_meta_data='{}' where id='"+id(1001)+"'",
      "update auth.users set email='real@example.com' where id='"+id(1001)+"'",
      "update public.shifts set shift_summary='{}' where id='"+id(4001)+"'",
      "update public.dancer_profiles set slug='ordinary-profile' where id='"+id(2001)+"'",
    ]) {
      await pg.exec('begin');await pg.exec(sql);assert.equal((await roster()).length,additions);await pg.exec('rollback');
    }
    await pg.exec('begin;update public.dancer_age_verification_settings set enabled=true');
    assert.equal((await roster()).length,1,'Enforcement removes demo exemptions while preserving real verification');await pg.exec('rollback');
    await pg.query("insert into public.internal_roster_links(id,venue_id,kind,label,token) values($1,$2,'table','Table 1',$3)",[id(70),venueId,id(71)]);
    assert.ok((await pg.query('select public.internal_roster_request($1,$2,$3) result',[id(71),id(2001),id(80)])).rows[0].result.id);
    for(const role of ['anon','authenticated','service_role']) {
      await pg.exec('begin;set role '+role);await assert.rejects(()=>pg.query('select public.is_internal_demo_shift($1)',[id(4001)]),{code:'42501'});await pg.exec('rollback');
    }
    if (grid.key !== 'echo') {
      await pg.query('update public.venues set owner_user_id=null where id=$1',[venueId]);
      await pg.exec(publishSql(plan));
      assert.equal((await pg.query(demoRosterSql(grid))).rows.length,grid.target,'Unclaimed venue cards retain their public demo roster');
      assert.equal((await roster()).length,0,'Unclaimed venues do not gain internal staff access');
      assert.equal((await pg.query('select owner_user_id from public.venues where id=$1',[venueId])).rows[0].owner_user_id,null);
    }
  } finally {await pg.close();}
});
