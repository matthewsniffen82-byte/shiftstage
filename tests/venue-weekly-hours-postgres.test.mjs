import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { legacyVenueWeek } from '../src/lib/dancr/venue-weekly-hours.ts';

test('weekly migration backfills existing hours, validates schedules, and preserves restricted writes', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.venues(id int primary key, opens_at time, closes_at time);
      insert into public.venues values (1,'20:00','04:00'),(2,'08:30','08:30'),(3,null,null);
      grant usage on schema public to anon, authenticated, service_role;
      grant select(id) on public.venues to service_role;`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261030072541_venue_open_days.sql',import.meta.url),'utf8'));
    await db.exec('update venues set open_days=array[5,6] where id=1');
    await db.exec(readFileSync(new URL('../supabase/migrations/20261030074718_venue_weekly_hours.sql',import.meta.url),'utf8'));
    const rows=(await db.query('select weekly_hours from venues order by id')).rows;
    assert.deepEqual(rows[0].weekly_hours,legacyVenueWeek('20:00','04:00',[5,6]));
    assert.deepEqual(rows[1].weekly_hours,legacyVenueWeek('00:00','00:00'));
    assert.equal(rows[2].weekly_hours,null);
    const week=legacyVenueWeek('20:00','02:00');week[5]={mode:'custom',opensAt:'22:00',closesAt:'06:00'};week[6]={mode:'closed'};
    await db.exec('set role service_role');
    await db.query('update venues set weekly_hours=$1 where id=1',[JSON.stringify(week)]);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select weekly_hours from venues where id=1')).rows[0].weekly_hours,week);
    for(const invalid of [{},[],[...week,{mode:'closed'}],week.map(()=>null),[...week.slice(0,6),{mode:'custom',opensAt:'24:00',closesAt:'03:00'}],[...week.slice(0,6),{mode:'custom',opensAt:'20:00',closesAt:'20:00'}],[...week.slice(0,6),{mode:'custom',opensAt:'20:00'}],[...week.slice(0,6),{mode:'24-hours',extra:true}]]) {
      await assert.rejects(db.query('update venues set weekly_hours=$1 where id=1',[JSON.stringify(invalid)]),error=>error.code==='23514');
    }
    await db.query('update venues set weekly_hours=$1 where id=3',[JSON.stringify(legacyVenueWeek('',''))]);
    for(const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      assert.equal((await db.query('select weekly_hours from venues')).rows.length,3);
      await assert.rejects(db.exec('update venues set weekly_hours=null'),error=>error.code==='42501');
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
