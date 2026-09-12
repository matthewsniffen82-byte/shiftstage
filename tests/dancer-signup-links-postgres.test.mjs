import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test, {before, beforeEach, after} from 'node:test';
import {createProvisioningDatabase, snapshot} from './helpers/account-provisioning-database.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20260912202533_respect_reserved_dancer_signup_links.sql', import.meta.url), 'utf8');
const oldAllocator = snapshot.functions.find(f => f.name === 'unique_dancer_slug');
const assignment = snapshot.functions.find(f => f.name === 'assign_dancer_profile_link');
const userId = n => `a1930000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
before(async () => { db = await createProvisioningDatabase(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('reset role; truncate auth.users cascade;');
  await db.exec(oldAllocator.definition + '; revoke all on function public.unique_dancer_slug(text,uuid) from public,anon,authenticated,service_role;');
});
const apply = () => db.exec(migration);
const signup = async (n, stageName) => {
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [userId(n), `signup-${n}@example.invalid`, JSON.stringify({role:'dancer', ...(stageName === undefined ? {} : {stage_name:stageName})})]);
  return (await db.query('select id,user_id,slug from public.dancer_profiles where user_id=$1', [userId(n)])).rows[0];
};
const rename = (n, slug) => db.query('update public.dancer_profiles set slug=$2 where user_id=$1', [userId(n), slug]);
const linkState = async () => (await db.query("select jsonb_build_object('profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.dancer_profiles p),'aliases',(select coalesce(jsonb_agg(to_jsonb(a) order by slug),'[]') from public.dancer_profile_slug_aliases a)) state")).rows[0].state;

test('the captured allocator reproduces failed signup when the placeholder is a retained link', async () => {
  await signup(1); await rename(1, 'established-profile');
  const before = await linkState();
  await assert.rejects(signup(2), e => e.code === '23505' && /Profile link is already assigned/.test(e.message));
  assert.deepEqual(await linkState(), before);
  assert.equal((await db.query('select count(*)::int n from auth.users where id=$1', [userId(2)])).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from public.app_users where id=$1', [userId(2)])).rows[0].n, 0);
});

test('a blank-name signup skips the retained placeholder and preserves its owner', async () => {
  const owner = await signup(1); await rename(1, 'established-profile');
  await apply();
  const created = await signup(2);
  assert.equal(created.slug, 'dancer-1');
  const state = await linkState();
  assert.equal(state.profiles.find(p => p.id === owner.id).slug, 'established-profile');
  assert.equal(state.aliases.find(a => a.slug === 'dancer').dancer_id, owner.id);
});

test('the allocator skips a chain of current and retained placeholder links', async () => {
  await signup(1); await rename(1, 'dancer-1'); await rename(1, 'dancer-2'); await rename(1, 'established-profile');
  await apply();
  assert.equal((await signup(2)).slug, 'dancer-3');
  assert.equal((await signup(3)).slug, 'dancer-4');
  assert.deepEqual((await linkState()).aliases.map(a => a.slug), ['dancer', 'dancer-1', 'dancer-2']);
});

test('a named signup skips another dancer’s old stage-name link', async () => {
  const owner = await signup(1, 'Moon Light'); await rename(1, 'established-profile');
  await apply();
  assert.equal((await signup(2, 'Moon Light')).slug, 'moon-light-1');
  assert.equal((await linkState()).aliases.find(a => a.slug === 'moon-light').dancer_id, owner.id);
});

test('existing current names still receive a unique numeric suffix', async () => {
  await signup(1, 'Moon Light'); await apply();
  assert.equal((await signup(2, 'Moon Light')).slug, 'moon-light-1');
  assert.equal((await signup(3, 'Moon Light')).slug, 'moon-light-2');
});

test('a profile may reuse its own current and retained links', async () => {
  await signup(1, 'Moon Light'); await rename(1, 'established-profile'); await apply();
  for (const [name, expected] of [['Moon Light','moon-light'], ['Established Profile','established-profile']]) {
    assert.equal((await db.query('select public.unique_dancer_slug($1,$2) slug', [name,userId(1)])).rows[0].slug, expected);
  }
});

test('a missing owner never bypasses either occupied-link registry', async () => {
  await signup(1); await rename(1, 'dancer-1'); await apply();
  assert.equal((await db.query("select public.unique_dancer_slug('',null) slug")).rows[0].slug, 'dancer-2');
});

test('applying the correction twice leaves existing profiles, aliases and assignment trigger unchanged', async () => {
  await signup(1); await rename(1, 'established-profile');
  const before = await linkState();
  await apply(); await apply();
  assert.deepEqual(await linkState(), before);
  assert.equal((await db.query("select md5(pg_get_functiondef('public.assign_dancer_profile_link()'::regprocedure)) hash")).rows[0].hash, assignment.fingerprint);
});

test('explicit attempts to take another dancer’s retained link remain rejected atomically', async () => {
  await signup(1, 'Moon Light'); await rename(1, 'established-profile'); await apply(); await signup(2, 'Second Profile');
  const before = await linkState();
  await assert.rejects(rename(2, 'moon-light'), e => e.code === '23505');
  assert.deepEqual(await linkState(), before);
});

test('the allocator remains internal, with a fresh snapshot and a bounded wait', async () => {
  await apply();
  const row = (await db.query("select provolatile,prosecdef,proconfig from pg_proc where oid='public.unique_dancer_slug(text,uuid)'::regprocedure")).rows[0];
  assert.equal(row.provolatile, 'v'); assert.equal(row.prosecdef, false);
  assert.deepEqual(row.proconfig, ['search_path=pg_catalog, pg_temp','lock_timeout=3s']);
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,'public.unique_dancer_slug(text,uuid)','execute') allowed", [role])).rows[0].allowed, false);
    await db.exec('set role ' + role);
    try { await assert.rejects(db.query("select public.unique_dancer_slug('Probe',$1)", [userId(9)]), e => e.code === '42501'); }
    finally { await db.exec('reset role'); }
  }
});

test('allocation holds the assignment lock until the surrounding transaction ends', async () => {
  await apply(); await db.exec('begin');
  try {
    await db.query("select public.unique_dancer_slug('Probe',$1)", [userId(9)]);
    const locks = (await db.query("select classid::text,objid::text,objsubid,mode,granted from pg_locks where locktype='advisory' and pid=pg_backend_pid()")).rows;
    assert.deepEqual(locks, [{classid:'1',objid:'3387483705',objsubid:1,mode:'ExclusiveLock',granted:true}]);
  } finally { await db.exec('rollback'); }
  assert.equal((await db.query("select count(*)::int n from pg_locks where locktype='advisory' and pid=pg_backend_pid()")).rows[0].n, 0);
});
