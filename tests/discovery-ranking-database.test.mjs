import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>'91000000-0000-4000-8000-'+String(n).padStart(12,'0');
const migration=readFileSync('supabase/migrations/20261010034253_discovery_ranking.sql','utf8');
test('production migration enforces visibility, capped freshness, private data and exposure-normalized aggregates',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table public.dancer_profiles(id uuid primary key,city text,status text,verification_status text,is_public boolean,disabled_at timestamptz);
   create table public.venues(id uuid primary key,is_active boolean,deal boolean);
   create function public.has_active_club_deal(public.venues) returns boolean language sql as 'select $1.deal';
   create table public.shifts(id uuid primary key,dancer_id uuid,venue_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz,starts_at timestamptz,ends_at timestamptz);
   create table public.dancer_photos(id uuid primary key,dancer_id uuid,review_status text,created_at timestamptz);
   create table public.mydancr_tv_videos(id uuid primary key,dancer_id uuid,status text,duration_seconds numeric,published_at timestamptz,expires_at timestamptz);
   grant usage on schema public to anon,authenticated,service_role;grant select on all tables in schema public to service_role;`);
  await db.exec(migration);
  await db.query(`insert into dancer_profiles select x,'Vegas','approved','approved',true,null from unnest($1::uuid[]) x`,[[id(1),id(2),id(3),id(4),id(5)]]);
  await db.query(`update dancer_profiles set is_public=false where id=$1;`,[id(2)]);
  await db.query(`update dancer_profiles set disabled_at=now() where id=$1;`,[id(3)]);
  await db.query(`update dancer_profiles set verification_status='pending' where id=$1;`,[id(4)]);
  await db.query(`update dancer_profiles set city='Miami' where id=$1;`,[id(5)]);
  await db.query('insert into venues values($1,true,true),($2,true,false)',[id(10),id(11)]);
  await db.query(`insert into shifts values($1,$2,$3,'posted',now(),null,'club_confirmed',now()+interval '1 hour',now(),now()+interval '4 hours')`,[id(20),id(1),id(10)]);
  await db.query(`insert into dancer_photos values($1,$2,'approved',date_trunc('day',now())),($3,$2,'pending',now())`,[id(30),id(1),id(31)]);
  await db.query(`insert into mydancr_tv_videos values($1,$2,'approved',20,now()-interval '2 hours',null),($3,$2,'pending',20,now(),null),($4,$2,'approved',20,now()-interval '2 days',now()-interval '1 hour'),($5,$2,'approved',20,now()+interval '1 day',null)`,[id(40),id(1),id(41),id(42),id(43)]);
  const candidates=async(surface='grid',city='Vegas',venue=null)=>(await db.query('select get_discovery_candidates($1,$2,$3) rows',[surface,city,venue])).rows[0].rows;
  let rows=await candidates();assert.equal(rows.length,1);assert.equal(rows[0].id,id(1));assert.ok(Date.parse(rows[0].availableUntil)>Date.now());
  assert.equal((await candidates('grid','Vegas',id(11))).length,0);
  assert.equal((await candidates('tv'))[0].id,id(40));assert.equal((await candidates('tv')).length,1);
  assert.equal((await candidates('grid','')).length,2);
  const before=rows[0].freshAt;
  await db.query(`insert into dancer_photos values($1,$2,'approved',now())`,[id(32),id(1)]);
  assert.equal((await candidates())[0].freshAt,before,'multiple uploads on one UTC day do not stack or restart freshness');
  for (const event of ['impression','profile_click','follow','engaged','completed']) {
   await db.query(`insert into discovery_events(viewer_hash,dancer_id,entity_id,surface,event_type,position) values($1,$2,$3,'tv',$4,4) on conflict do nothing`,['a'.repeat(64),id(1),id(40),event]);
  }
  await db.query(`insert into discovery_events(viewer_hash,dancer_id,entity_id,surface,event_type,position) values($1,$2,$3,'tv','impression',0) on conflict do nothing`,['a'.repeat(64),id(1),id(40)]);
  await db.query(`insert into discovery_events(viewer_hash,dancer_id,entity_id,surface,event_type,position) values($1,$2,$3,'tv','completed',0)`,['b'.repeat(64),id(1),id(40)]);
  const metrics=(await candidates('tv'))[0].buckets;
  assert.deepEqual(metrics,[{impressions:0,actions:0,engaged:0,completed:0},{impressions:1,actions:1,engaged:1,completed:1},{impressions:0,actions:0,engaged:0,completed:0}]);
  await db.query(`update shifts set location_verification_expires_at=now()-interval '1 second' where id=$1`,[id(20)]);
  assert.equal((await candidates())[0].availableUntil,null);
  for (const role of ['anon','authenticated']) {
   await db.exec('set role '+role);
   await assert.rejects(db.query('select * from discovery_events'),/permission denied/);
   await assert.rejects(db.query('select * from discovery_sessions'),/permission denied/);
   await assert.rejects(candidates(),/permission denied/);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');assert.equal((await candidates()).length,1);
  await db.exec('select prune_discovery_history()');
 } finally {await db.close();}
});
