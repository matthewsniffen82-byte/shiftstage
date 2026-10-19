import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const marker='mydancr-spearmint-rhino-las-vegas-demo-v1', slug='spearmint-rhino-las-vegas-demo';
const echo='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af', star='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2', starShift='5dc264bc-c618-4ace-a689-c2791cb3e880';
const publish=read('scripts/publish-spearmint-rhino-demo.sql').replace(/\bbegin;/,'').replace(/commit;\s*$/,'');
let pg;
before(async()=>{
  pg=await createInternalRosterDatabase();
  await pg.exec(`alter table auth.users add column email text,add column raw_user_meta_data jsonb,add column raw_app_meta_data jsonb,add column banned_until timestamptz;
    alter table public.venue_dancer_affiliations add column reentry_blocked boolean not null default false;
    alter table public.club_deals add column offer_type text;
    create table public.dancer_age_verification_settings(singleton boolean primary key,enabled boolean);
    insert into public.dancer_age_verification_settings values(true,false);`);
  await pg.exec(read('supabase/migrations/20260929100000_internal_demo_roster.sql'));
  await pg.exec(read('supabase/migrations/20261019212456_spearmint_rhino_demo_roster.sql'));
  await pg.exec(read('supabase/migrations/20261019034059_venue_guest_colors.sql'));
  const ledger = read('supabase/migrations/20261011232707_venue_performance_channels.sql').replace(/\r/g,'');
  await pg.exec(ledger.slice(ledger.indexOf('create table public.venue_dancer_work_sessions'), ledger.indexOf('insert into public.venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at)\nselect')).replace(/\r/g,''));
  const accuracy = read('supabase/migrations/20261013024002_dancer_roster_accuracy_scores.sql');
  await pg.exec(accuracy.slice(accuracy.indexOf('alter table public.venue_dancer_work_sessions'), accuracy.indexOf('revoke all on function public.capture_venue_work_session()')));
  await pg.exec(`create table public.venue_interactions(id uuid primary key default gen_random_uuid(),venue_id uuid);
    create table public.venue_page_events(id uuid primary key default gen_random_uuid(),venue_id uuid,event_type text,source text,session_id text,occurred_on date,
      unique(venue_id,event_type,source,session_id,occurred_on));`);
});
beforeEach(async()=>{
  await pg.exec('begin;reset role');
  await pg.query(`insert into auth.users(id,email,raw_app_meta_data,banned_until) values($1,$2,$3,'2099-12-31'),($4,'echo@synthetic.mydancr.invalid','{}','2099-12-31')`,[id(50),slug+'@synthetic.mydancr.invalid',JSON.stringify({dataset_marker:marker}),id(51)]);
  await pg.query("insert into public.app_users(id,role,account_state) values($1,'venue','active'),($2,'venue','active')",[id(50),id(51)]);
  await pg.query("insert into public.venues(id,name,slug,city,owner_user_id,is_active) values($1,'Rhino',$2,'Las Vegas',$3,false),($4,'Echo House','talk-of-the-town','Las Vegas',$5,true)",[id(60),slug,id(50),echo,id(51)]);
  // Fifty source fixtures means one must remain at Echo after selecting 49.
  for(let index=1;index<=51;index++){
    const isStar=index===51, dancer=isStar?star:id(100+index), shift=isStar?starShift:id(300+index), user=id(200+index);
    const dancerSlug=isStar?'lvdegen11':`echo-grid-${String(index).padStart(3,'0')}`;
    const summary=isStar?{managedBy:'codex-star-echo-assignment',internalDemoProfile:'star-test-v1'}:{managedBy:'mydancr-echo-grid-v1'};
    await pg.query("insert into auth.users(id,email,raw_user_meta_data,banned_until) values($1,$2,$3,'2099-12-31')",[user,dancerSlug+'@synthetic.mydancr.invalid',JSON.stringify({dataset_marker:'mydancr-echo-grid-v1'})]);
    await pg.query("insert into public.app_users(id,role,account_state) values($1,'dancer','active')",[user]);
    await pg.query("insert into public.dancer_profiles(id,user_id,real_name,stage_name,slug,city,status,verification_status,is_public,avatar_storage_path) values($1,$2,'Demo',$3,$4,'Las Vegas','approved','approved',true,'demo/avatar.png')",[dancer,user,isStar?'Star':dancerSlug,dancerSlug]);
    await pg.query("insert into public.dancer_age_verifications(user_id,provider,status) values($1,'ondato','pending')",[user]);
    await pg.query('insert into public.venue_dancer_affiliations(venue_id,dancer_id) values($1,$2)',[echo,dancer]);
    await pg.query("insert into public.dancer_channel_preferences(dancer_id,visibility) values($1,'both')",[dancer]);
    await pg.query(`insert into public.shifts(id,dancer_id,venue_id,venue_affiliation_id,starts_at,ends_at,shift_date,status,shift_source,checked_in_at,location_status,location_verification_expires_at,shift_summary)
      select $1,$2,$3,a.id,now()-interval '1 day','2099-12-31',current_date,'posted',$4,now()-interval '1 day','club_confirmed','2099-12-31',$5 from public.venue_dancer_affiliations a where a.venue_id=$3 and a.dancer_id=$2`,[shift,dancer,echo,isStar?'nfc_presence':'demo_locked',JSON.stringify({...summary,demoLocked:true,internalDemoRoster:true})]);
    await pg.query("insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility) values($1,$2,$3,'both')",[shift,dancer,echo]);
  }
});
afterEach(async()=>pg.exec('rollback;reset role'));
after(async()=>pg?.close());
const roster=async club=>(await pg.query('select id from public.internal_roster_members($1)',[club])).rows;

test('atomic assignment shows exactly 50 including Star in both rosters and preserves all profiles/verification',async()=>{
  const before=(await pg.query('select to_jsonb(d) profile from public.dancer_profiles d order by id')).rows;
  await pg.exec(publish);
  assert.equal((await roster(id(60))).length,50);
  assert.ok((await roster(id(60))).some(d=>d.id===star));
  assert.equal((await roster(echo)).length,1);
  assert.equal((await pg.query('select count(*) from public.venue_roster_members($1) where internal_visible and external_visible',[id(60)])).rows[0].count,50);
  assert.deepEqual((await pg.query('select to_jsonb(d) profile from public.dancer_profiles d order by id')).rows,before);
  assert.equal((await pg.query("select count(*) from public.dancer_age_verifications where status='pending'")).rows[0].count,51);
  assert.equal((await pg.query('select count(*) from public.venue_dancer_affiliations where venue_id=$1',[echo])).rows[0].count,51);
  assert.equal((await pg.query("select count(*) from public.club_deals where venue_id=$1 and is_active",[id(60)])).rows[0].count,0);
});
test('a staff removal is never reversed by assignment',async()=>{
  await pg.query("update public.venue_dancer_affiliations set reentry_blocked=true where dancer_id=$1",[star]);
  await assert.rejects(pg.exec(publish),/Refusing to reverse a staff removal/);
});
test('a missing Star rolls back instead of publishing a partial roster',async()=>{
  await pg.query('update public.shifts set checked_out_at=now() where id=$1',[starShift]);
  await assert.rejects(pg.exec(publish),/Expected 49 Echo demos plus Star/);
});
test('publishing twice cannot silently move 49 more dancers',async()=>{
  await pg.exec(publish);
  await pg.exec('drop table rhino_demo_roster;drop table rhino_demo_club');
  await assert.rejects(pg.exec(publish),/Club already has shifts/);
});
for(const [reason,sql] of [
  ['real age enforcement',"update public.dancer_age_verification_settings set enabled=true"],
  ['missing assignment marker',"update public.shifts set shift_summary=shift_summary-'demoAssignment' where venue_id='"+id(60)+"'"],
  ['enabled manager sign-in',"update auth.users set banned_until=null where id='"+id(50)+"'"],
  ['untrusted manager marker',"update auth.users set raw_app_meta_data='{}' where id='"+id(50)+"'"],
])test(reason+' removes demo verification exemptions',async()=>{
  await pg.exec(publish);await pg.exec(sql);assert.equal((await roster(id(60))).length,0);
});
test('discovery exception is limited to the disabled demo owner and preserves real offer eligibility',async()=>{
  const eligible=async club=>(await pg.query('select public.has_active_club_deal(v) allowed from public.venues v where id=$1',[club])).rows[0].allowed;
  assert.equal(await eligible(id(60)),true);assert.equal(await eligible(echo),false);
  await pg.query("insert into public.club_deals(venue_id,is_active,payout_type,payout_amount_cents,offer_type,deal_title) values($1,true,'flat',500,'admission','Free admission')",[echo]);
  assert.equal(await eligible(echo),true);
  await pg.query("update auth.users set raw_app_meta_data='{}' where id=$1",[id(50)]);
  assert.equal(await eligible(id(60)),false);
});
for(const role of ['anon','authenticated','service_role'])test(role+' cannot call the internal demo exemption directly',async()=>{
  await pg.exec('set role '+role);await assert.rejects(pg.query('select public.is_internal_demo_shift($1)',[starShift]),{code:'42501'});
});

const consolidate=read('scripts/consolidate-rhino-into-echo.sql').replace(/\bbegin;/,'').replace(/commit;\s*$/,'')
  .replaceAll('11fd5e46-d24f-4a02-87f6-2aa18b0876ae',id(60)).replaceAll('02b3af5c-779e-4d3c-af08-b70ae0b31de5',id(51));
async function prepareMerge(){
  await pg.exec(publish);
  await pg.query("insert into public.club_deals(venue_id,is_active,payout_type,payout_amount_cents,offer_type,deal_title) values($1,true,'flat',500,'admission','Free admission')",[echo]);
  await pg.query('insert into public.venue_interactions(venue_id) values($1)',[id(60)]);
  await pg.query("insert into public.venue_page_events(venue_id,event_type,source,session_id,occurred_on) values($1,'page_view','venue_page','session-same',current_date),($2,'page_view','venue_page','session-same',current_date),($2,'page_view','venue_page','session-other',current_date)",[echo,id(60)]);
}
test('consolidation preserves the original account, Free Entry, dancer data, sessions and QR tokens',async()=>{
  await prepareMerge();
  const before=(await pg.query('select to_jsonb(d) row from public.dancer_profiles d order by id')).rows;
  const accounts=(await pg.query('select to_jsonb(u) row from auth.users u order by id')).rows;
  const deals=(await pg.query('select to_jsonb(d) row from public.club_deals d order by id')).rows;
  const sessions=(await pg.query('select id,started_at,closed_at,dancer_check_in_at,dancer_check_out_at from public.venue_dancer_work_sessions order by id')).rows;
  const links=(await pg.query('select id,token from public.internal_roster_links where venue_id=$1',[id(60)])).rows;
  await pg.exec(consolidate);
  assert.equal((await roster(echo)).length,51);
  assert.equal((await roster(id(60))).length,0);
  assert.equal((await pg.query('select count(*) from public.venue_roster_members($1) where internal_visible and external_visible',[echo])).rows[0].count,51);
  const venue=(await pg.query('select name,slug,owner_user_id from public.venues where id=$1',[echo])).rows[0];
  assert.deepEqual(venue,{name:'Spearmint Rhino Las Vegas',slug:'talk-of-the-town',owner_user_id:id(51)});
  assert.deepEqual((await pg.query('select to_jsonb(d) row from public.dancer_profiles d order by id')).rows,before);
  assert.deepEqual((await pg.query('select to_jsonb(u) row from auth.users u order by id')).rows,accounts);
  assert.deepEqual((await pg.query('select to_jsonb(d) row from public.club_deals d order by id')).rows,deals);
  assert.deepEqual((await pg.query('select id,started_at,closed_at,dancer_check_in_at,dancer_check_out_at from public.venue_dancer_work_sessions order by id')).rows,sessions);
  assert.deepEqual((await pg.query('select id,token from public.internal_roster_links where venue_id=$1',[echo])).rows,links);
  assert.equal((await pg.query('select count(*) from public.venue_page_events where venue_id=$1',[echo])).rows[0].count,2);
  assert.equal((await pg.query('select count(*) from public.venue_interactions where venue_id=$1',[echo])).rows[0].count,1);
  assert.deepEqual((await pg.query('select internal_accent,embed_accent from public.venue_guest_colors where venue_id=$1',[echo])).rows[0],{internal_accent:'#b8860b',embed_accent:'#b8860b'});
  await assert.rejects(pg.exec(consolidate),/Expected original active Echo/);
});
test('consolidation stops if new operations or a staff removal require review',async()=>{
  await prepareMerge();
  await pg.query("insert into public.venue_team_members(venue_id,user_id,status) values($1,$2,'active')",[id(60),id(51)]);
  await assert.rejects(pg.exec(consolidate),/New source data in venue_team_members/);
});
test('consolidation never reverses a later staff removal at Echo',async()=>{
  await prepareMerge();
  await pg.query('update public.venue_dancer_affiliations set reentry_blocked=true where venue_id=$1 and dancer_id=$2',[echo,star]);
  await assert.rejects(pg.exec(consolidate),/Expected 50 original shifts/);
});
