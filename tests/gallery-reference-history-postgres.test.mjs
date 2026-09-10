import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260910092022_add_gallery_reference_history.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), other = id(2), profile = id(11), otherProfile = id(12), photo = id(21);
const schema = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table public.dancer_profiles(id uuid primary key,user_id uuid not null,avatar_storage_path text,stage_name text);
create table public.dancer_photos(id uuid primary key,dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  storage_path text not null,alt_text text,review_status text not null default 'approved');
alter table public.dancer_profiles enable row level security;
alter table public.dancer_photos enable row level security;
create policy profile_owner on public.dancer_profiles to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy photo_owner on public.dancer_photos to authenticated using(exists(select 1 from public.dancer_profiles d where d.id=dancer_id and d.user_id=auth.uid()))
  with check(exists(select 1 from public.dancer_profiles d where d.id=dancer_id and d.user_id=auth.uid()));
grant select,delete on public.dancer_photos,public.dancer_profiles to authenticated;
grant all on public.dancer_photos,public.dancer_profiles to service_role;
-- Model broad provider defaults to prove the migration removes inherited grants.
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
`;
let pg, baselineBefore, baselineAfter, capturedBaseline;
const history = async () => (await pg.query('select * from public.gallery_media_reference_history order by event_id')).rows;
const source = async () => ({ profiles: (await pg.query('select * from public.dancer_profiles order by id')).rows,
  photos: (await pg.query('select * from public.dancer_photos order by id')).rows });
async function seed() {
  await pg.query('insert into public.dancer_profiles(id,user_id,avatar_storage_path) values($1,$2,$3),($4,$5,null)', [profile,owner,'avatar-old',otherProfile,other]);
  await pg.query('insert into public.dancer_photos(id,dancer_id,storage_path) values($1,$2,$3)',[photo,profile,'photo-old']);
}
before(async () => {
  pg = new PGlite(); await pg.exec(schema); await seed(); baselineBefore = await source();
  await pg.exec(migration); baselineAfter = await source(); capturedBaseline = await history();
});
after(async () => pg?.close());
beforeEach(async () => {
  await pg.exec(`reset role; drop trigger if exists synthetic_history_failure on public.gallery_media_reference_history;
    drop trigger if exists synthetic_photo_failure on public.dancer_photos;
    truncate public.gallery_media_reference_history,public.dancer_photos,public.dancer_profiles;`);
  await seed();
  await pg.exec('truncate public.gallery_media_reference_history;set role service_role');
});

test('migration captures current references without changing source records or fabricating publication dates', () => {
  assert.deepEqual(baselineAfter, baselineBefore);
  assert.deepEqual(capturedBaseline.map(row=>[row.source_kind,row.source_id,row.profile_id,row.storage_path,row.event_kind]),
    [['photo',photo,profile,'photo-old','baseline'],['avatar',profile,profile,'avatar-old','baseline']]);
  assert.ok(capturedBaseline.every(row=>row.recorded_at && row.transaction_id));
});

test('new gallery references and avatar replacements record exact paths and a shared transaction', async () => {
  await pg.exec('begin');
  await pg.query('insert into public.dancer_photos(id,dancer_id,storage_path) values($1,$2,$3)',[id(22),profile,'photo-new']);
  await pg.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',['avatar-new',profile]);
  await pg.exec('commit');
  const rows=await history();
  assert.deepEqual(rows.map(row=>[row.source_kind,row.event_kind,row.storage_path]),
    [['photo','referenced','photo-new'],['avatar','released','avatar-old'],['avatar','referenced','avatar-new']]);
  assert.equal(new Set(rows.map(row=>row.transaction_id)).size,1);
});

test('changed photo paths record both sides while preserving the source identity', async () => {
  await pg.query('update public.dancer_photos set storage_path=$1 where id=$2',['new-path',photo]);
  const rows=await history();
  assert.deepEqual(rows.map(row=>[row.event_kind,row.storage_path,row.source_id]),[['released','photo-old',photo],['referenced','new-path',photo]]);
});

test('profile moves and photo identity changes preserve both old and new associations', async () => {
  await pg.query('update public.dancer_photos set dancer_id=$1,id=$2 where id=$3',[otherProfile,id(25),photo]);
  assert.deepEqual((await history()).map(row=>[row.event_kind,row.profile_id,row.source_id]),
    [['released',profile,photo],['referenced',otherProfile,id(25)]]);
});

test('unrelated updates and unchanged values do not inflate reference history', async () => {
  await pg.query("update public.dancer_photos set review_status='rejected',alt_text='changed' where id=$1",[photo]);
  await pg.query("update public.dancer_profiles set stage_name='new label' where id=$1",[profile]);
  await pg.query('update public.dancer_photos set storage_path=storage_path,id=id,dancer_id=dancer_id where id=$1',[photo]);
  await pg.query('update public.dancer_profiles set avatar_storage_path=avatar_storage_path,id=id where id=$1',[profile]);
  assert.deepEqual(await history(),[]);
});

test('null and empty avatars create no false reference while removal of a real avatar is retained', async () => {
  await pg.query('update public.dancer_profiles set avatar_storage_path=null where id=$1',[profile]);
  await pg.query("update public.dancer_profiles set avatar_storage_path='' where id=$1",[profile]);
  await pg.query('update public.dancer_profiles set avatar_storage_path=null where id=$1',[profile]);
  assert.deepEqual((await history()).map(row=>[row.event_kind,row.storage_path]),[['released','avatar-old']]);
});

test('profile deletion and cascading photo deletion preserve both references without source FKs', async () => {
  await pg.query('delete from public.dancer_profiles where id=$1',[profile]);
  const rows=await history();
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.storage_path).sort(),['avatar-old','photo-old']);
  assert.ok(rows.every(row=>row.event_kind==='released' && row.profile_id===profile));
  assert.equal((await source()).photos.length,0);
});

test('a shared path remains distinguishable as two separate references', async () => {
  await pg.query('insert into public.dancer_photos(id,dancer_id,storage_path) values($1,$2,$3)',[id(22),otherProfile,'photo-old']);
  await pg.query('delete from public.dancer_photos where id=$1',[photo]);
  const rows=await history();
  assert.deepEqual(rows.map(row=>[row.event_kind,row.profile_id]),[['referenced',otherProfile],['released',profile]]);
  assert.equal((await source()).photos[0].storage_path,'photo-old');
});

test('transaction rollback removes history and source changes together', async () => {
  const before=await source();
  await pg.exec('begin');
  await pg.query('delete from public.dancer_photos where id=$1',[photo]);
  assert.equal((await history()).length,1);
  await pg.exec('rollback');
  assert.deepEqual(await source(),before);
  assert.deepEqual(await history(),[]);
});

test('history write failure rolls back the original photo deletion', async () => {
  await pg.exec(`reset role;create function public.synthetic_history_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic history outage';end$$;
    create trigger synthetic_history_failure before insert on public.gallery_media_reference_history for each row execute function public.synthetic_history_failure();set role service_role;`);
  const before=await source();
  await assert.rejects(pg.query('delete from public.dancer_photos where id=$1',[photo]),/synthetic history outage/);
  assert.deepEqual(await source(),before);
  assert.deepEqual(await history(),[]);
});

for (const role of ['anon','authenticated']) {
  test(`${role} cannot read, forge, alter or erase history, including through default grants`,async()=>{
    await pg.query('delete from public.dancer_photos where id=$1',[photo]);
    assert.equal((await history()).length,1,'negative reads target a real private history row');
    await pg.exec(`set role ${role}`);
    for(const sql of ['select * from public.gallery_media_reference_history','update public.gallery_media_reference_history set event_kind=event_kind',
      'delete from public.gallery_media_reference_history','truncate public.gallery_media_reference_history',
      `insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind) values('photo','${photo}','${profile}','forged','released')`,
      'select public.capture_gallery_media_reference_history()',"select nextval('public.gallery_media_reference_history_event_id_seq')"])
      await assert.rejects(pg.exec(sql),error=>error.code==='42501');
  });
}

test('the service can read history but cannot directly forge, update or erase observations',async()=>{
  for(const sql of ['update public.gallery_media_reference_history set event_kind=event_kind','delete from public.gallery_media_reference_history',
    'truncate public.gallery_media_reference_history',`insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind) values('photo','${photo}','${profile}','forged','released')`,
    'select public.capture_gallery_media_reference_history()']) await assert.rejects(pg.exec(sql),error=>error.code==='42501');
  assert.deepEqual(await history(),[]);
});

test('permitted owner deletion still records history while cross-owner deletion remains denied by RLS',async()=>{
  await pg.query('insert into public.dancer_photos(id,dancer_id,storage_path) values($1,$2,$3)',[id(22),otherProfile,'other-photo']);
  await pg.exec('reset role;truncate public.gallery_media_reference_history;set role authenticated');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  assert.equal((await pg.query('delete from public.dancer_photos where id=$1 returning id',[id(22)])).rows.length,0);
  assert.equal((await pg.query('delete from public.dancer_photos where id=$1 returning id',[photo])).rows.length,1);
  await pg.exec('set role service_role');
  assert.deepEqual((await history()).map(row=>row.source_id),[photo]);
});

test('a trigger attached to another relation cannot use the privileged history writer',async()=>{
  await pg.exec(`reset role;create table public.synthetic_foreign_source(id uuid,storage_path text,dancer_id uuid);
    create trigger wrong_source after insert on public.synthetic_foreign_source for each row execute function public.capture_gallery_media_reference_history();`);
  await assert.rejects(pg.query('insert into public.synthetic_foreign_source values($1,$2,$3)',[photo,'foreign',profile]),error=>error.code==='42501');
  assert.deepEqual(await history(),[]);
});

test('the journal is private, has a fixed definer search path and an indexed profile history',async()=>{
  const table=(await pg.query("select relrowsecurity from pg_class where oid='public.gallery_media_reference_history'::regclass")).rows[0];
  assert.equal(table.relrowsecurity,true);
  const fn=(await pg.query("select prosecdef,proconfig from pg_proc where oid='public.capture_gallery_media_reference_history()'::regprocedure")).rows[0];
  assert.equal(fn.prosecdef,true); assert.ok(fn.proconfig.includes('search_path=""'));
  assert.equal((await pg.query("select count(*)::int as n from pg_policy where polrelid='public.gallery_media_reference_history'::regclass")).rows[0].n,0);
  assert.equal((await pg.query("select count(*)::int as n from pg_constraint where conrelid='public.gallery_media_reference_history'::regclass and contype='f'")).rows[0].n,0);
  assert.equal((await pg.query("select indisvalid from pg_index where indexrelid='public.gallery_media_reference_history_profile_event_idx'::regclass")).rows[0].indisvalid,true);
});
