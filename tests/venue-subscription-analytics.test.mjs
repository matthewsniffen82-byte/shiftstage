import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { signVenueVideo, readVenueVideo, VENUE_VIDEO_COOKIE } from '../src/lib/dancr/venue-video-attribution.ts';
import { venueMetricChange } from '../src/lib/dancr/venue-analytics.ts';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const migration=readFileSync(new URL('../supabase/migrations/20260916190000_venue_subscription_analytics.sql',import.meta.url),'utf8');
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table venues(id uuid primary key);create table dancer_profiles(id uuid primary key,stage_name text);
 create table shifts(id uuid primary key,venue_id uuid,dancer_id uuid);
 create table going_signals(shift_id uuid,created_at timestamptz);
 create table venue_follows(venue_id uuid,created_at timestamptz);
 create table venue_page_events(venue_id uuid,event_type text,session_id text,occurred_at timestamptz);
 create table club_shuttle_requests(id uuid,venue_id uuid,created_at timestamptz,notification_rows jsonb);
 create table pickup_requests(venue_id uuid,party_size int,requested_at timestamptz);
 create table qr_redemptions(id uuid primary key,venue_id uuid,dancer_id uuid,admission_pass_version int,status text,generated_at timestamptz,redeemed_at timestamptz,redemption_token text);
 create table mydancr_tv_videos(id uuid primary key,venue_id uuid,dancer_id uuid,caption text,venue_tag_status text,published_at timestamptz,expires_at timestamptz,status text);
 create table mydancr_tv_events(id uuid default gen_random_uuid(),video_id uuid,event_type text,occurred_at timestamptz);
 grant usage on schema public to service_role;grant select,insert on all tables in schema public to service_role;`);
 await db.exec(migration);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260916190100_report_current_pickup_receipts.sql',import.meta.url),'utf8'));
 await db.exec('revoke all on pickup_requests from service_role');
 await db.query('insert into venues values($1),($2)',[id(1),id(2)]);
 await db.query("insert into dancer_profiles values($1,'Dancer A'),($2,'Dancer B')",[id(10),id(11)]);
 await db.query("insert into mydancr_tv_videos values($1,$2,$3,'Tagged','confirmed','2026-09-01',null,'approved'),($4,$5,$3,'Other club','confirmed','2026-09-01',null,'approved'),($6,$2,$3,'Unconfirmed','pending','2026-09-01',null,'approved')",[id(20),id(1),id(10),id(21),id(2),id(22)]);
});
after(async()=>db?.close());
async function report(){return (await db.query("select get_venue_subscription_analytics($1,'2026-09-10','2026-09-17') result",[id(1)])).rows[0].result;}

test('one venue action counts once, keeps dancer attribution, and excludes other venues',async()=>{
 await db.query("insert into venue_interactions(id,venue_id,dancer_id,event_type,source,session_id,occurred_at) values($1,$2,$3,'directions','dancer_profile','browser-one','2026-09-12') on conflict do nothing",[id(100),id(1),id(10)]);
 await db.query("insert into venue_interactions(id,venue_id,dancer_id,event_type,source,session_id,occurred_at) values($1,$2,$3,'directions','dancer_profile','browser-one','2026-09-12') on conflict do nothing",[id(100),id(1),id(10)]);
 await db.query("insert into venue_interactions(id,venue_id,event_type,source,session_id,occurred_at) values($1,$2,'directions','venue_detail','browser-other','2026-09-12')",[id(101),id(2)]);
 const r=await report();assert.equal(r.current.directions,1);assert.equal(r.interactions[0].total,1);assert.equal(r.dancers[0].metrics.directions,1);
 assert.equal(JSON.stringify(r).includes('browser-one'),false);
});
test('unique visitors deduplicate sources and days; totals are not capped at 1000 rows',async()=>{
 await db.query("insert into venue_page_events select $1,'page_view','browser-'||n,'2026-09-12' from generate_series(1,1501) n",[id(1)]);
 await db.query("insert into venue_page_events values($1,'page_view','browser-1','2026-09-13'),($1,'qr_impression','not-a-view','2026-09-13')",[id(1)]);
 assert.equal((await report()).current.visitors,1501);
});
test('claims and admissions use their own dates, and attributed outcomes do not multiply venue totals',async()=>{
 await db.query("insert into qr_redemptions values($1,$2,$3,1,'redeemed','2026-09-05','2026-09-12','old-claim'),($4,$2,$3,1,'redeemed','2026-09-12','2026-09-13','new-claim'),($5,$2,$3,null,'redeemed','2026-09-12','2026-09-13','legacy')",[id(30),id(1),id(10),id(31),id(32)]);
 await db.query('insert into venue_video_passes values($1,$2)',[id(31),id(20)]);
 const r=await report();assert.equal(r.current.claims,1);assert.equal(r.current.admissions,2);assert.equal(r.previous.claims,1);assert.equal(r.dancers[0].metrics.admissions,2);
 assert.equal(r.videos[0].metrics.claims,1);assert.equal(r.videos[0].metrics.admissions,1);
});
test('TV includes only confirmed venue tags, even when other videos have the same dancer',async()=>{
 for (const n of [20,21,22]) await db.query("insert into mydancr_tv_events(video_id,event_type,occurred_at) values($1,'impression','2026-09-12'),($1,'impression','2026-09-01')",[id(n)]);
 const r=await report();assert.equal(r.videos.length,1);assert.equal(r.videos[0].id,id(20));assert.equal(r.videos[0].metrics.impression,1);
});
test('pickup totals count current form receipts once despite multiple notification recipients',async()=>{
 const notice={payload:{kind:'club_shuttle_request',requestId:id(600),venueId:id(1),partySize:3}};
 await db.query("insert into club_shuttle_requests values($1,$2,'2026-09-12',$3)",[id(600),id(1),JSON.stringify([notice,notice])]);
 const r=await report();assert.equal(r.current.pickups,1);assert.equal(r.current.passengers,3);
});
test('private raw events and aggregate RPC are inaccessible to public roles',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(report(),/permission denied/);
  await assert.rejects(db.query('select * from venue_interactions'),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await report()).current.directions,1);await db.exec('reset role');
 await assert.rejects(db.query("select get_venue_subscription_analytics($1,'2026-01-01','2026-09-17')",[id(1)]),/31 days/);
});
test('video attribution is signed, venue-specific, and expires after 30 minutes',()=>{
 const secret='test-only-secret',now=Date.now(),value=signVenueVideo(id(20),id(1),secret,now);
 const req=v=>new Request('https://mydancr.com',{headers:{cookie:`${VENUE_VIDEO_COOKIE}=${v}`}});
 assert.equal(readVenueVideo(req(value),id(1),secret,now),id(20));
 assert.equal(readVenueVideo(req(value),id(2),secret,now),null);
 assert.equal(readVenueVideo(req(value.replace(id(20),id(21))),id(1),secret,now),null);
 assert.equal(readVenueVideo(req(value),id(1),secret,now+1800001),null);
 assert.equal(readVenueVideo(req(value),id(1),undefined,now),null);
 assert.equal(venueMetricChange(10,5),'+100% vs prior period');
});

test('video pass issuance cannot reattribute a reused pass or credit another venue',async()=>{
 await db.exec(`create function public.issue_admission_pass(p_token text,p_deal_id uuid,p_session_id uuid,p_customer_id uuid,p_source text,p_dancer_id uuid,p_shift_id uuid,p_arrival_method text)
 returns jsonb language plpgsql as $$ begin
 if p_arrival_method='reuse' then return jsonb_build_object('token','existing');end if;
 insert into public.qr_redemptions(id,venue_id,admission_pass_version,status,generated_at,redemption_token) values(gen_random_uuid(),p_deal_id,1,'generated',now(),p_token);
 return jsonb_build_object('token',p_token);end $$;`);
 const issue=async(token,video,arrival='self_drive')=>db.query('select public.issue_video_admission_pass($1,$2,$3,null,$4,null,null,$5,$6)',[token,id(1),id(500),'club_page',arrival,video]);
 await issue('new-video-pass',id(20));
 await issue('unused-token',id(20),'reuse');
 await issue('other-venue-video',id(21));
 const links=(await db.query("select r.redemption_token from venue_video_passes a join qr_redemptions r on r.id=a.pass_id where r.redemption_token in ('new-video-pass','unused-token','other-venue-video')")).rows;
 assert.deepEqual(links,[{redemption_token:'new-video-pass'}]);
});
