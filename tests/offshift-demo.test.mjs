import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { OFFSHIFT_MARKER, OFFSHIFT_NAMES, offshiftSlug, offshiftPublicationSql } from '../scripts/lib/offshift-demo.mjs';
const id = n => `96000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = { marker: OFFSHIFT_MARKER, profiles: OFFSHIFT_NAMES.map((name, i) => ({
  user_id: id(100 + i), dancer_id: id(200 + i), slug: offshiftSlug(i), name,
  photos: Array.from({ length: 3 }, (_, j) => ({ id: id(1000 + i * 3 + j), source_id: id(10 + j), source_path: `approved/${j}.jpg`,
    storage_path: `${id(100 + i)}/${id(200 + i)}/${OFFSHIFT_MARKER}/${j}.jpg` })),
})) };
const sql = offshiftPublicationSql(plan).replace(/^begin;$/m, '').replace(/^commit;$/m, '');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key,email text,banned_until timestamptz,raw_app_meta_data jsonb);
    create table public.app_users(id uuid primary key,role text,account_state text);
    create table public.dancer_profiles(id uuid primary key,user_id uuid,slug text,stage_name text,real_name text,city text,
      status text,verification_status text,photo_review_status text,is_public boolean,approved_at timestamptz,
      venue_approved_at timestamptz,disabled_at timestamptz,avatar_storage_path text,updated_at timestamptz);
    create table public.dancer_photos(id uuid primary key,dancer_id uuid,storage_path text,is_primary boolean,sort_order integer,review_status text,alt_text text);
    create table public.shifts(id uuid primary key,dancer_id uuid,payload jsonb);
    create table public.venue_dancer_affiliations(dancer_id uuid);
    create table public.mydancr_tv_videos(dancer_id uuid);
    create table public.dancer_channel_preferences(dancer_id uuid primary key,visibility text);
    create table public.dancer_age_verification_settings(singleton boolean,enabled boolean);
    insert into public.dancer_age_verification_settings values(true,false);`);
  // Exercise the actual three-photo onboarding guard during publication.
  const migration = readFileSync(new URL('../supabase/migrations/20261020224618_venue_dancer_media_review.sql', import.meta.url), 'utf8');
  const guard = migration.match(/create or replace function public.enforce_dancer_onboarding_photos\(\)[\s\S]*?end \$\$;/i)?.[0];
  assert.ok(guard); await db.exec(guard);
  await db.query("insert into dancer_profiles(id,user_id,slug,status,verification_status,is_public,approved_at) values($1,$2,'lvdegen11','approved','approved',true,now())", [id(1), id(2)]);
  for (let i = 0; i < 3; i++) await db.query("insert into dancer_photos(id,dancer_id,storage_path,review_status) values($1,$2,$3,'approved')", [id(10 + i), id(1), `approved/${i}.jpg`]);
  await db.query("insert into shifts values($1,$2,'{\"workingNow\":true}')", [id(3), id(1)]);
  for (const p of plan.profiles) {
    await db.query("insert into auth.users values($1,$2,now()+interval '100 years',$3)", [p.user_id, p.slug + '@synthetic.mydancr.invalid', { dataset_marker: OFFSHIFT_MARKER }]);
    await db.query("insert into app_users values($1,'dancer','active')", [p.user_id]);
    await db.query("insert into dancer_profiles(id,user_id,slug,status,is_public) values($1,$2,$3,'draft',false)", [p.dancer_id, p.user_id, p.slug]);
  }
  await db.exec('create trigger photo_minimum before update of status,verification_status,venue_approved_at on dancer_profiles for each row execute function enforce_dancer_onboarding_photos()');
});
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback'));
after(async () => db?.close());

test('publishes exactly nine off-shift profiles and leaves existing workers untouched on repeat runs', async () => {
  const before = (await db.query('select * from shifts')).rows;
  await db.exec(sql); await db.exec(sql);
  const profiles = (await db.query("select d.*,count(p.id)::int photos from dancer_profiles d join dancer_photos p on p.dancer_id=d.id where d.slug like 'offshift-demo-%' group by d.id")).rows;
  assert.equal(profiles.length, 9); assert.ok(profiles.every(p => p.photos === 3 && p.is_public && p.status === 'approved' && p.verification_status === 'approved'));
  assert.deepEqual((await db.query('select * from shifts')).rows, before);
  assert.equal((await db.query('select count(*)::int n from venue_dancer_affiliations')).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from dancer_channel_preferences where visibility='external'")).rows[0].n, 9);
});

for (const [name, change] of [
  ['login-enabled account', 'update auth.users set banned_until=null'],
  ['unmarked account', "update auth.users set raw_app_meta_data='{}'"],
  ['changed approved source', "update dancer_photos set review_status='rejected'"],
  ['real age enforcement', 'update dancer_age_verification_settings set enabled=true'],
  ['existing shift on a new profile', `insert into shifts values('${id(99)}','${id(200)}','{}')`],
]) test(`refuses ${name} and rolls back publication`, async () => {
  await db.exec(change); await db.exec('savepoint publication'); await assert.rejects(db.exec(sql));
  await db.exec('rollback to publication');
  assert.equal((await db.query("select count(*)::int n from dancer_profiles where slug like 'offshift-demo-%' and is_public")).rows[0].n, 0);
});

test('rejects duplicate identities, wrong count and foreign storage paths before generating SQL', () => {
  const duplicate = structuredClone(plan); duplicate.profiles[1].dancer_id = duplicate.profiles[0].dancer_id;
  assert.throws(() => offshiftPublicationSql(duplicate));
  assert.throws(() => offshiftPublicationSql({ ...plan, profiles: plan.profiles.slice(1) }));
  const foreign = structuredClone(plan); foreign.profiles[0].photos[0].storage_path = 'someone-else/photo.jpg';
  assert.throws(() => offshiftPublicationSql(foreign));
});
