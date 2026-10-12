import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { MIN_DANCER_ONBOARDING_PHOTOS, approvedProfilePhotoCount } from '../src/lib/dancr/media-limits.ts';

let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create table dancer_profiles(id text primary key, status text default 'draft', verification_status text default 'pending', approved_at timestamptz, venue_approved_at timestamptz);
    create table dancer_photos(id text primary key, dancer_id text, review_status text);
    insert into dancer_profiles values('legacy', 'approved', 'approved', now(), now()), ('submitted', 'pending_review', 'pending', null, null);`);
  const migration = readFileSync(new URL('../supabase/migrations/20261012033238_dancer_onboarding_three_photos.sql', import.meta.url), 'utf8');
  await db.exec(migration.split('-- Keep early taps pending')[0] + '\ncommit;');
});
after(async () => db?.close());

test('only distinct approved gallery rows count; pending, rejected, and missing IDs do not', () => {
  assert.equal(MIN_DANCER_ONBOARDING_PHOTOS, 3);
  assert.equal(approvedProfilePhotoCount([{id:'1',status:'approved'}, {id:'1',status:'approved'}, {id:'2',status:'pending'}, {id:'3',status:'rejected'}, {status:'approved'}]), 1);
  assert.equal(approvedProfilePhotoCount([{id:'1',review_status:'approved'}, {id:'2',review_status:'approved'}, {id:'3',review_status:'approved'}]), 3);
});
test('first submission requires three approved photos, and first activation checks again', async () => {
  await db.exec(`insert into dancer_profiles(id) values('new');
    insert into dancer_photos values('1','new','approved'),('2','new','approved'),('3','new','pending');`);
  await assert.rejects(db.exec("update dancer_profiles set status='pending_review' where id='new'"), /At least 3 profile photos/);
  await db.exec("update dancer_photos set review_status='approved' where id='3'; update dancer_profiles set status='pending_review' where id='new';");
  await db.exec("update dancer_photos set review_status='rejected' where id='3'");
  await assert.rejects(db.exec("update dancer_profiles set status='approved', verification_status='approved', approved_at=now(), venue_approved_at=now() where id='new'"), /At least 3 profile photos/);
  await db.exec("update dancer_photos set review_status='approved' where id='3'; update dancer_profiles set status='approved', verification_status='approved', approved_at=now(), venue_approved_at=now() where id='new';");
  assert.equal((await db.query("select status from dancer_profiles where id='new'")).rows[0].status, 'approved');
});
test('legacy submissions cannot bypass the minimum through NFC first activation', async () => {
  await assert.rejects(db.exec("update dancer_profiles set status='approved',venue_approved_at=now() where id='submitted'"), /At least 3 profile photos/);
});
test('already activated dancers can edit, check in, and reactivate without losing approval', async () => {
  await db.exec("update dancer_profiles set status='disabled' where id='legacy'; update dancer_profiles set status='approved', verification_status='approved', venue_approved_at=now() where id='legacy'");
  assert.equal((await db.query("select status from dancer_profiles where id='legacy'")).rows[0].status, 'approved');
});
test('inserting an already-submitted or approved profile cannot bypass setup', async () => {
  for (const status of ['pending_review', 'approved']) {
    await assert.rejects(db.query('insert into dancer_profiles(id,status) values($1,$2)', [status,status]), /At least 3 profile photos/);
  }
});
test('the trigger adds no privileged callable function', async () => {
  const row = (await db.query("select prosecdef, proconfig, has_function_privilege('anon','enforce_dancer_onboarding_photos()','EXECUTE') as anon, has_function_privilege('authenticated','enforce_dancer_onboarding_photos()','EXECUTE') as authenticated from pg_proc where proname='enforce_dancer_onboarding_photos'")).rows[0];
  assert.equal(row.prosecdef, false); assert.equal(row.anon, false); assert.equal(row.authenticated, false);
  assert.match(row.proconfig.join(' '), /search_path/);
});
