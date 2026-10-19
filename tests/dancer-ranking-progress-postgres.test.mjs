import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

const read = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
let pg;
before(async () => {
  pg = await createInternalRosterDatabase();
  await pg.exec(`create table public.venue_dancer_work_sessions (
    id uuid primary key default gen_random_uuid(),shift_id uuid,venue_id uuid,dancer_id uuid,
    started_at timestamptz,expires_at timestamptz,closed_at timestamptz);
    alter table public.venue_dancer_work_sessions enable row level security;
    grant select on public.venue_dancer_work_sessions to service_role;`);
  const accuracy = read('20261013024002_dancer_roster_accuracy_scores.sql');
  await pg.exec(accuracy.slice(0,accuracy.indexOf('alter function public.get_venue_performance_analytics'))+'commit;');
  await pg.exec('create trigger capture_venue_work_session after insert or update or delete on public.shifts for each row execute function public.capture_venue_work_session()');
  const both = read('20261013031912_dancer_both_roster_score_weight.sql');
  await pg.exec(both.slice(0,both.indexOf('create or replace function public.get_venue_performance_analytics'))+'commit;');
  const external = read('20261019053609_dancer_external_roster_score_weight.sql');
  await pg.exec(external.slice(0,external.indexOf('-- Replace only the scoring layer'))+'commit;');
  await pg.exec(read('20261019055434_dancer_ranking_progress_and_both.sql'));
});
beforeEach(() => pg.exec('begin;set role service_role'));
afterEach(() => pg.exec('rollback;reset role'));
after(() => pg?.close());
const checkIn = async (mode='internal') => (await pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5) result',[id(30),id(1),id(50),mode,{}])).rows[0].result;
const enable = async (shiftId,user=id(1)) => (await pg.query('select public.enable_dancer_shift_both($1,$2) result',[user,shiftId])).rows[0].result;
const progress = async (dancer=id(10)) => (await pg.query('select public.get_dancer_shift_ranking_progress($1) result',[dancer])).rows[0].result;
const shift = async shiftId => (await pg.query('select * from public.shifts where id=$1',[shiftId])).rows[0];
const ledger = async shiftId => (await pg.query('select * from public.venue_dancer_work_sessions where shift_id=$1',[shiftId])).rows[0];
async function rejected(action,code) { await pg.exec('savepoint rejection');await assert.rejects(action,e=>e.code===code);await pg.exec('rollback to rejection'); }

test('switch keeps the verified shift, cooldown and internal roster and starts external credit prospectively',async()=>{
  const tap=await checkIn(),before=await shift(tap.shiftId);
  assert.equal((await progress())[0].visibility,'internal');
  assert.equal((await progress())[0].externalHours,0);
  const result=await enable(tap.shiftId);
  assert.equal(result.changed,true);assert.equal(result.isPublic,true);assert.equal(result.visibility,'both');
  assert.deepEqual(await shift(tap.shiftId),before,'never changes shift times or tap/cooldown fields');
  assert.equal((await pg.query('select * from public.internal_roster_members($1)',[id(20)])).rows.length,1);
  assert.equal((await progress())[0].visibility,'both');
  assert.ok((await ledger(tap.shiftId)).external_roster_started_at);
  const start=(await ledger(tap.shiftId)).external_roster_started_at;
  assert.equal((await enable(tap.shiftId)).changed,false);
  assert.deepEqual((await ledger(tap.shiftId)).external_roster_started_at,start,'retry does not restart credit');
  await pg.query('update public.dancer_profiles set is_public=false where id=$1',[id(10)]);
  assert.equal((await enable(tap.shiftId)).isPublic,false,'retry does not undo later Incognito');
});

for (const [label,change,code] of [
  ['expired',"update public.shifts set starts_at=now()-interval '7 hours',ends_at=now()-interval '1 hour',checked_in_at=now()-interval '7 hours',last_location_verified_at=now()-interval '7 hours',nfc_last_tapped_at=now()-interval '7 hours',location_verification_expires_at=now()-interval '1 hour' where dancer_id=$1",'40001'],
  ['checked out',"update public.shifts set checked_out_at=clock_timestamp() where dancer_id=$1",'40001'],
  ['admin suspension',"update public.dancer_profiles set admin_disabled_at=clock_timestamp() where id=$1",'42501'],
  ['revoked affiliation',"update public.venue_dancer_affiliations set status='revoked',revoked_at=clock_timestamp() where dancer_id=$1",'42501'],
  ['missing NFC proof',"update public.shifts set nfc_tag_id=null where dancer_id=$1",'40001'],
]) test(label+' cannot switch visibility',async()=>{
  const tap=await checkIn();await pg.query(change,[id(10)]);await rejected(()=>enable(tap.shiftId),code);
  assert.equal((await pg.query('select visibility from public.dancer_channel_preferences where dancer_id=$1',[id(10)])).rows[0].visibility,'internal');
});

test('inactive account, unverified age and disabled club cannot publish or change modes',async()=>{
  const tap=await checkIn();
  for(const sql of ["update public.app_users set account_state='disabled' where id='"+id(1)+"'",
    "delete from public.dancer_age_verifications where user_id='"+id(1)+"'",
    "update public.venues set is_active=false where id='"+id(20)+"'"]){
    await pg.exec('savepoint fixture');await pg.exec(sql);await rejected(()=>enable(tap.shiftId),'42501');await pg.exec('rollback to fixture');
  }
});

test('another dancer and external-only sessions cannot use the Internal-to-Both action',async()=>{
  const tap=await checkIn('external');await rejected(()=>enable(tap.shiftId),'40001');
  await pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5)',[id(30),id(5),id(51),'internal',{}]);
  await rejected(()=>enable(tap.shiftId,id(5)),'P0002');
  const other=await progress(id(11));assert.equal(other.length,1);assert.notEqual(other[0].shiftId,tap.shiftId);
});

test('a publication failure rolls both mode updates and credit back together',async()=>{
  const tap=await checkIn();
  await pg.exec(`reset role;create function synthetic_publication_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end$$;
    create trigger synthetic_failure before update on public.dancer_profiles for each row execute function synthetic_publication_failure();set role service_role;`);
  await rejected(()=>enable(tap.shiftId),'P0001');
  assert.equal((await progress())[0].visibility,'internal');assert.equal((await ledger(tap.shiftId)).external_roster_started_at,null);
});

test('recorded progress unions Both and External intervals, clips to the shift and never invents unknown time',async()=>{
  const tap=await checkIn();
  await pg.exec('reset role;alter table public.shifts disable trigger capture_venue_work_session;alter table public.venue_dancer_work_sessions disable trigger all');
  await pg.query("update public.shifts set checked_in_at=now()-interval '3 hours' where id=$1",[tap.shiftId]);
  await pg.query(`update public.venue_dancer_work_sessions set started_at=now()-interval '3 hours',
    both_roster_periods=tstzmultirange(tstzrange(now()-interval '3 hours',now()-interval '1 hour','[)')),
    external_roster_periods=tstzmultirange(tstzrange(now()-interval '2 hours',now()-interval '1 hour','[)')),
    external_roster_started_at=now()-interval '30 minutes' where shift_id=$1`,[tap.shiftId]);
  await pg.exec('set role service_role');assert.equal((await progress())[0].externalHours,2.5);
  await pg.exec('reset role');await pg.query("update public.venue_dancer_work_sessions set both_roster_periods='{}',external_roster_periods='{}',external_roster_started_at=null,external_roster_observed_at=null where shift_id=$1",[tap.shiftId]);
  await pg.exec('set role service_role');assert.equal((await progress())[0].externalHours,null);
  assert.deepEqual(await progress(id(11)),[]);
});

test('progress and mutation RPCs are service-only security invokers',async()=>{
  for(const signature of ['get_dancer_shift_ranking_progress(uuid)','enable_dancer_shift_both(uuid,uuid)']){
    assert.equal((await pg.query('select prosecdef from pg_proc where oid=$1::regprocedure',[signature])).rows[0].prosecdef,false);
    for(const role of ['anon','authenticated','service_role'])
      assert.equal((await pg.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,signature])).rows[0].allowed,role==='service_role');
  }
});
