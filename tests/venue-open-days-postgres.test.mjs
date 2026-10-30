import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('open-day migration preserves old schedules, validates values, and keeps writes private', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.venues (id int primary key, name text);
      insert into public.venues values (1, 'Existing club');
      grant usage on schema public to anon, authenticated, service_role;
      grant select(id) on public.venues to service_role;`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261030072541_venue_open_days.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select open_days from venues where id=1')).rows[0].open_days, [0, 1, 2, 3, 4, 5, 6]);
    await db.exec('set role service_role; update public.venues set open_days=array[5,6] where id=1; reset role;');
    assert.deepEqual((await db.query('select open_days from venues where id=1')).rows[0].open_days, [5, 6]);
    for (const value of ["'{}'", 'array[7]', 'array[-1]', 'array[1,null]', 'null', 'array[[1,2],[3,4]]']) {
      await assert.rejects(db.exec(`update public.venues set open_days=${value}::smallint[] where id=1`));
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      assert.deepEqual((await db.query('select open_days from public.venues')).rows[0].open_days, [5, 6]);
      await assert.rejects(db.exec('update public.venues set open_days=array[1]'), error => error.code === '42501');
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
