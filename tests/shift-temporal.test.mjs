import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {createShiftDatabase,seedShifts,insertShift,shiftSnapshot,shiftId,shiftMigration,shiftSchema} from './helpers/shift-temporal-database.mjs';
let db;
before(async()=>{db=await createShiftDatabase();});
after(async()=>{await db?.close();});
beforeEach(async()=>{await seedShifts(db);});
const code=c=>error=>error.code===c;

test('the full shift target keeps all 38 columns, 15 indexes and three original attachments',async()=>{
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='shifts'")).rows[0].n,38);
  assert.equal((await db.query("select count(*)::int n from pg_indexes where schemaname='public'and tablename='shifts'")).rows[0].n,15);
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='public.shifts'::regclass and not tgisinternal")).rows[0].n,3);
});
for(const [label,change,day]of[
  ['omitted local date',{shift_date:null},'2026-10-04'],
  ['UTC start still on yesterday locally',{starts_at:'2026-10-04T02:01Z',shift_date:null},'2026-10-03'],
  ['Sydney spring transition',{starts_at:'2026-10-03T14:01Z',ends_at:'2026-10-04T13:01Z',timezone:'Australia/Sydney'},'2026-10-04'],
  ['blank timezone retains legacy UTC fallback',{timezone:'',shift_date:null},'2026-10-04'],
])test(label+' derives the expected local date',async()=>{const row=await insertShift(db,change);assert.equal(row.shift_date.toISOString().slice(0,10),day);});

test('changing a start across local midnight refreshes the unchanged stored date',async()=>{
  await insertShift(db);
  await db.exec("update public.shifts set starts_at='2026-10-03T22:00Z'");
  assert.equal((await shiftSnapshot(db))[0].shift_date,'2026-10-03');
});
test('changing only timezone refreshes the unchanged stored date',async()=>{
  await insertShift(db,{starts_at:'2026-10-04T01:00Z',shift_date:'2026-10-03'});
  await db.exec("update public.shifts set timezone='Pacific/Auckland'");
  assert.equal((await shiftSnapshot(db))[0].shift_date,'2026-10-04');
});
test('a valid explicit date and changed schedule are retained exactly',async()=>{
  await insertShift(db);
  await db.exec("update public.shifts set starts_at='2026-10-05T07:01Z',ends_at='2026-10-06T07:01Z',shift_date='2026-10-05'");
  const row=(await shiftSnapshot(db))[0];assert.equal(row.shift_date,'2026-10-05');assert.equal(row.starts_at,'2026-10-05T07:01:00+00:00');
});
for(const [label,operation]of[
  ['mismatched insert',()=>insertShift(db,{shift_date:'2026-10-03'})],
  ['mismatched date-only edit',()=>db.exec("update public.shifts set shift_date='2026-10-03'")],
  ['mismatched explicit schedule edit',()=>db.exec("update public.shifts set starts_at='2026-10-05T07:01Z',ends_at='2026-10-06T07:01Z',shift_date='2026-10-06'")],
])test(label+' rejects atomically',async()=>{
  if(!label.includes('insert'))await insertShift(db);
  const before=await shiftSnapshot(db);await assert.rejects(operation(),code('22007'));assert.deepEqual(await shiftSnapshot(db),before);
});
for(const field of ['starts_at','ends_at','shift_date','checked_in_at','checked_out_at'])for(const value of ['infinity','-infinity'])
  test(field+' rejects '+value+' before it can persist',async()=>{
    const row={id:shiftId(1001),[field]:value};
    if(field==='checked_out_at')row.checked_in_at='2026-10-04T08:00Z';
    await assert.rejects(insertShift(db,row),e=>['22007','23514'].includes(e.code));
    assert.deepEqual(await shiftSnapshot(db),[]);
  });
test('an end-only update cannot bypass the finite-time constraint',async()=>{
  await insertShift(db);const before=await shiftSnapshot(db);
  await assert.rejects(db.exec("update public.shifts set ends_at='infinity'"),code('23514'));assert.deepEqual(await shiftSnapshot(db),before);
});
test('a checkout cannot precede check-in even when both instants are finite',async()=>{
  await assert.rejects(insertShift(db,{checked_in_at:'2026-10-04T09:00Z',checked_out_at:'2026-10-04T08:59Z'}),code('23514'));
  assert.deepEqual(await shiftSnapshot(db),[]);
});
test('same-instant checkout and normal completed sessions remain valid',async()=>{
  for(const [n,at]of[[1000,'2026-10-04T09:00Z'],[1001,'2026-10-04T10:00Z']])await insertShift(db,{id:shiftId(n),status:'completed',checked_in_at:'2026-10-04T09:00Z',checked_out_at:at});
  assert.equal((await shiftSnapshot(db)).length,2);
});
test('the existing checkout-presence and end-after-start constraints remain effective',async()=>{
  for(const row of [{checked_out_at:'2026-10-04T09:00Z'},{ends_at:'2026-10-04T07:01Z'},{ends_at:'2026-10-04T07:00Z'}])await assert.rejects(insertShift(db,row),code('23514'));
});
test('invalid timezone and missing required temporal values fail without a row',async()=>{
  for(const row of [{timezone:'Mars/Olympus'},{timezone:null},{starts_at:null},{ends_at:null}])await assert.rejects(insertShift(db,row));
  assert.deepEqual(await shiftSnapshot(db),[]);
});
test('correcting the derived date still respects posted-date uniqueness',async()=>{
  await insertShift(db);
  await insertShift(db,{id:shiftId(1001),shift_date:'2026-10-05',starts_at:'2026-10-05T07:01Z',ends_at:'2026-10-06T07:01Z'});
  const before=await shiftSnapshot(db);
  await assert.rejects(db.exec("update public.shifts set starts_at='2026-10-04T07:01Z'where id='"+shiftId(1001)+"'"),e=>e.code==='23505'&&e.constraint==='shifts_one_posted_scheduled_date_idx');
  assert.deepEqual(await shiftSnapshot(db),before);
});
test('multi-row edits roll back every date when any row would conflict',async()=>{
  await insertShift(db);
  await insertShift(db,{id:shiftId(1001),shift_date:'2026-10-05',starts_at:'2026-10-05T07:01Z',ends_at:'2026-10-06T07:01Z'});
  const before=await shiftSnapshot(db);
  await assert.rejects(db.exec("update public.shifts set starts_at='2026-10-03T07:01Z'"),code('23505'));
  assert.deepEqual(await shiftSnapshot(db),before);
});
test('NFC presence and centrally managed demo rows keep their distinct valid semantics',async()=>{
  await insertShift(db,{shift_source:'nfc_presence',nfc_tag_id:shiftId(200),nfc_last_tapped_at:'2026-10-04T09:00Z',checked_in_at:'2026-10-04T09:00Z',commission_tracking_started_at:'2026-10-04T09:00Z'});
  await insertShift(db,{id:shiftId(1001),shift_source:'demo_locked',working_status:'checked_in',checked_in_at:'2026-10-04T09:00Z'});
  assert.equal((await shiftSnapshot(db)).length,2);
  await assert.rejects(insertShift(db,{id:shiftId(1002),shift_source:'demo_locked',nfc_tag_id:shiftId(200)}),code('23514'));
});
test('the affiliation trigger still requires active NFC proof for a new check-in',async()=>{
  await insertShift(db,{venue_id:shiftId(101)});const before=await shiftSnapshot(db);
  await assert.rejects(db.exec("update public.shifts set checked_in_at='2026-10-04T09:00Z'"),code('42501'));assert.deepEqual(await shiftSnapshot(db),before);
  await db.exec("update public.shifts set venue_id='"+shiftId(100)+"',checked_in_at='2026-10-04T09:00Z'");
  assert.equal((await shiftSnapshot(db))[0].venue_affiliation_id,shiftId(300));
});
for(const role of ['anon','authenticated'])test(role+' still has no direct shift mutation privileges',async()=>{
  await db.exec('set role '+role);await assert.rejects(insertShift(db),code('42501'));
  await db.exec('reset role');assert.deepEqual(await shiftSnapshot(db),[]);
});
test('the replacement remains an invoker with no API execution and preserved dependency bodies',async()=>{
  await db.exec('reset role');
  const f=(await db.query("select prosecdef,proacl::text acl,proconfig from pg_proc where oid='public.set_shift_date_from_starts_at()'::regprocedure")).rows[0];
  assert.equal(f.prosecdef,false);assert.equal(f.acl,'{postgres=X/postgres}');assert.deepEqual(f.proconfig,['search_path=pg_catalog, public, pg_temp']);
  for(const dep of shiftSchema.functions.filter(f=>f.name!=='set_shift_date_from_starts_at'))assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',['public.'+dep.signature])).rows[0].hash,dep.fingerprint);
});
test('the old trigger permits a stale date and non-finite schedule without indicating a production incident',async()=>{
  const old=await createShiftDatabase({migrate:false});try{await seedShifts(old);await insertShift(old);await old.exec("update public.shifts set starts_at='2026-10-03T07:01Z',ends_at='infinity'");const row=(await shiftSnapshot(old))[0];assert.equal(row.shift_date,'2026-10-04');assert.equal(row.ends_at,'infinity');}finally{await old.close();}
});
test('migration rejects pre-existing invalid chronology without changing rows or the old function',async()=>{
  const old=await createShiftDatabase({migrate:false});try{await seedShifts(old);await insertShift(old,{checked_in_at:'2026-10-04T09:00Z',checked_out_at:'2026-10-04T08:00Z'});const before=await shiftSnapshot(old);await old.exec('reset role');try{await assert.rejects(old.exec(shiftMigration),code('23514'));}finally{await old.exec('rollback');}assert.deepEqual(await shiftSnapshot(old),before);assert.equal((await old.query("select md5(pg_get_functiondef('public.set_shift_date_from_starts_at()'::regprocedure))hash")).rows[0].hash,'f9e79d46a086d6dd1afe273912f964c3');}finally{await old.close();}
});
