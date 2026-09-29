import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260929120000_internal_main_photos.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_users(id uuid primary key, role text, account_state text default 'active', dmca_suspended_at timestamptz);
    create table public.dancer_profiles(id uuid primary key, user_id uuid references public.app_users(id), disabled_at timestamptz, status text default 'draft', avatar_storage_path text default 'avatar.jpg');
    create table public.dancer_photos(id uuid primary key, dancer_id uuid references public.dancer_profiles(id), review_status text, is_primary boolean default false, is_pinned boolean default false);
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to service_role;
  `);
  await pg.exec(migration);
});
after(async () => pg?.close());
beforeEach(async () => {
  await pg.exec(`reset role; truncate dancer_internal_main_photos,dancer_photos,dancer_profiles,app_users;
    insert into app_users(id,role) values('${id(1)}','dancer'),('${id(2)}','dancer'),('${id(3)}','customer');
    insert into dancer_profiles(id,user_id) values('${id(11)}','${id(1)}'),('${id(12)}','${id(2)}');
    insert into dancer_photos(id,dancer_id,review_status,is_primary,is_pinned) values
      ('${id(21)}','${id(11)}','approved',true,true),
      ('${id(22)}','${id(11)}','approved',false,false),
      ('${id(23)}','${id(11)}','pending',false,false),
      ('${id(24)}','${id(11)}','rejected',false,false),
      ('${id(25)}','${id(12)}','approved',true,true);
    set role service_role;`);
});
const choose = async (photo = id(22), actor = id(1)) => (await pg.query('select set_dancer_internal_main_photo($1,$2) as photo', [actor, photo])).rows[0].photo;
const choices = async () => (await pg.query('select dancer_id,photo_id from dancer_internal_main_photos')).rows;

test('onboarding dancer can choose a gallery photo without changing avatar or public gallery', async () => {
  const before = await pg.query('select * from dancer_photos order by id');
  assert.equal(await choose(), id(22));
  assert.deepEqual(await choices(), [{ dancer_id: id(11), photo_id: id(22) }]);
  assert.deepEqual((await pg.query('select * from dancer_photos order by id')).rows, before.rows);
  assert.equal((await pg.query('select avatar_storage_path from dancer_profiles where id=$1', [id(11)])).rows[0].avatar_storage_path, 'avatar.jpg');
});
test('retries and replacing a choice keep exactly one main photo', async () => {
  await choose(); await choose(); await choose(id(21));
  assert.deepEqual(await choices(), [{ dancer_id: id(11), photo_id: id(21) }]);
});
for (const [label, photo] of [['pending',23],['rejected',24],['foreign',25],['missing',99]]) {
  test(label + ' photos cannot replace the chosen photo', async () => {
    await choose(); await assert.rejects(choose(id(photo)), { code: 'P0002' });
    assert.equal((await choices())[0].photo_id, id(22));
  });
}
for (const update of ["account_state='disabled'", "account_state='deleted'", "dmca_suspended_at=now()", "role='customer'"]) {
  test('denies account with ' + update, async () => {
    await pg.exec(`update app_users set ${update} where id='${id(1)}'`);
    await assert.rejects(choose(), { code: '42501' }); assert.deepEqual(await choices(), []);
  });
}
test('disabled profile cannot select photos', async () => {
  await pg.exec(`update dancer_profiles set disabled_at=now() where id='${id(11)}'`);
  await assert.rejects(choose(), { code: '42501' });
});
test('deleting a selected photo clears only its preference', async () => {
  await choose(); await pg.query('delete from dancer_photos where id=$1', [id(22)]);
  assert.deepEqual(await choices(), []);
  assert.equal((await pg.query('select count(*)::int as n from dancer_photos')).rows[0].n, 4);
});
for (const role of ['anon','authenticated']) {
  test(role + ' cannot read, write, or call the privileged selector', async () => {
    await pg.exec('set role ' + role);
    await assert.rejects(choose(), { code: '42501' });
    await assert.rejects(pg.query('select * from dancer_internal_main_photos'), { code: '42501' });
    await assert.rejects(pg.query('insert into dancer_internal_main_photos(dancer_id,photo_id) values($1,$2)', [id(11),id(22)]), { code: '42501' });
  });
}
test('selector has invoker security, empty search path and bounded locking', async () => {
  const row = (await pg.query("select prosecdef,proconfig from pg_proc where oid='public.set_dancer_internal_main_photo(uuid,uuid)'::regprocedure")).rows[0];
  assert.equal(row.prosecdef, false); assert.ok(row.proconfig.includes('search_path=""')); assert.ok(row.proconfig.includes('lock_timeout=3s'));
});
