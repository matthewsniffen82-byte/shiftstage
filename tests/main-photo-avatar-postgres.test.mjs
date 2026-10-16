import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { createAvatarDatabase, seedAvatarDatabase, avatarUser, avatarProfile, avatarPath, fixtureId, putAvatarObject, readAvatarProfile } from './helpers/avatar-publication-database.mjs';

const migration = readFileSync('supabase/migrations/' + readdirSync('supabase/migrations').find(name => name.endsWith('_main_photo_avatar.sql')), 'utf8');
let db;
const source = name => avatarUser + '/' + avatarProfile + '/' + name + '.jpg';
const mainId = fixtureId(100);
before(async () => { db = await createAvatarDatabase(); await db.exec(migration); });
after(async () => { await db?.close(); });
beforeEach(async () => { await seedAvatarDatabase(db); });
async function main(name = 'main', derivative = true) {
  const path = await putAvatarObject(db, source(name));
  if (derivative) await putAvatarObject(db, path + '.avatar.jpg');
  await db.query('update public.dancer_photos set is_primary=true,storage_path=$1 where id=$2', [path, mainId]);
  return path;
}
async function save({ user = avatarUser, photo = mainId, path = source('main'), version, output = avatarPath('custom') } = {}) {
  const current = await readAvatarProfile(db);
  await putAvatarObject(db, output);
  return (await db.query('select public.save_main_photo_avatar_crop($1,$2,$3,$4,$5,$6) result', [user, avatarProfile, photo, path, version ?? current.avatar_updated_at, output])).rows[0].result;
}

test('approved main photo and square avatar commit together without a separate avatar review', async () => {
  const path = await main(); const profile = await readAvatarProfile(db);
  assert.equal(profile.avatar_storage_path, path + '.avatar.jpg');
  assert.equal(profile.avatar_source_photo_id, mainId);
  assert.equal(profile.avatar_source_storage_path, path);
  assert.equal((await db.query('select count(*)::int n from public.image_moderation_records')).rows[0].n, 0);
});
test('older approved photos without a derivative remain usable', async () => {
  const path = await main('legacy', false); assert.equal((await readAvatarProfile(db)).avatar_storage_path, path);
});
test('a pending replacement does not change the approved main or avatar', async () => {
  await main(); const before = await readAvatarProfile(db);
  await db.query("update public.dancer_photos set storage_path=$1 where id=$2", [source('pending'), fixtureId(101)]);
  assert.deepEqual(await readAvatarProfile(db), before);
});
test('deferred synchronization sees only the final photo in an atomic replacement', async () => {
  await main(); const before = await readAvatarProfile(db);
  await putAvatarObject(db, source('new')); await putAvatarObject(db, source('new') + '.avatar.jpg');
  await db.exec('begin');
  await db.query('delete from public.dancer_photos where id=$1', [mainId]);
  assert.equal((await readAvatarProfile(db)).avatar_storage_path, before.avatar_storage_path);
  await db.query("insert into public.dancer_photos(id,dancer_id,storage_path,is_primary,sort_order,review_status) values($1,$2,$3,true,0,'approved')", [fixtureId(102), avatarProfile, source('new')]);
  await db.exec('commit');
  assert.equal((await readAvatarProfile(db)).avatar_storage_path, source('new') + '.avatar.jpg');
});
test('gallery edits preserve a manually adjusted avatar', async () => {
  await main(); await save(); const before = await readAvatarProfile(db);
  await db.query('update public.dancer_photos set is_pinned=false,sort_order=4 where id=$1', [fixtureId(101)]);
  assert.deepEqual(await readAvatarProfile(db), before);
});
test('changing the main image resets a manual crop to the new source', async () => {
  await main(); await save(); const path = await main('replacement');
  assert.equal((await readAvatarProfile(db)).avatar_storage_path, path + '.avatar.jpg');
});
for (const operation of ['delete', 'reject', 'unselect']) test(operation + ' clears the old main-derived avatar', async () => {
  await main(); await save();
  const sql = operation === 'delete' ? 'delete from public.dancer_photos where id=$1' : operation === 'reject' ? "update public.dancer_photos set review_status='rejected' where id=$1" : 'update public.dancer_photos set is_primary=false where id=$1';
  await db.query(sql, [mainId]); const profile = await readAvatarProfile(db);
  assert.equal(profile.avatar_storage_path, null); assert.equal(profile.avatar_source_photo_id, null);
});
test('manual crop saves only for the current owned approved main and advances its version', async () => {
  await main(); const before = await readAvatarProfile(db), result = await save();
  assert.equal(result.avatar_storage_path, avatarPath('custom'));
  assert.notEqual(result.avatar_updated_at, before.avatar_updated_at);
  assert.equal((await readAvatarProfile(db)).avatar_source_photo_id, mainId);
});
test('late crop cannot replace a newer main photo', async () => {
  await main(); const before = await readAvatarProfile(db); await main('replacement');
  await assert.rejects(save({ version: before.avatar_updated_at }), { code: '40001' });
});
test('late crop cannot overwrite another crop or an ABA main change', async () => {
  await main(); const version = (await readAvatarProfile(db)).avatar_updated_at;
  await save(); await assert.rejects(save({ version, output: avatarPath('late') }), { code: '40001' });
  await main('replacement'); await main(); await assert.rejects(save({ version }), { code: '40001' });
});
test('crop rejects other owners, non-main photos, changed sources and foreign storage', async () => {
  await main();
  await assert.rejects(save({ user: fixtureId(2) }), { code: '42501' });
  await assert.rejects(save({ photo: fixtureId(101) }), { code: '40001' });
  await assert.rejects(save({ path: source('stale') }), { code: '40001' });
  await assert.rejects(save({ output: 'someone/else/avatar.jpg' }), { code: '42501' });
});
test('disabled owners cannot crop their avatar', async () => {
  await main(); await db.query("update public.app_users set account_state='disabled' where id=$1", [avatarUser]);
  await assert.rejects(save(), { code: '42501' });
});
test('new functions remain invoker and crop execution is service-only', async () => {
  const signature = 'public.save_main_photo_avatar_crop(uuid,uuid,uuid,text,timestamptz,text)';
  const result = (await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service,prosecdef from pg_proc where oid=$1::regprocedure", [signature])).rows[0];
  assert.deepEqual(result, { anon: false, authenticated: false, service: true, prosecdef: false });
});

test('migration links existing main photos without replacing an existing avatar or unrelated profile state', async () => {
  const existing = await createAvatarDatabase();
  try {
    await seedAvatarDatabase(existing);
    await existing.query('update public.dancer_photos set is_primary=true where id=$1', [mainId]);
    const before = await readAvatarProfile(existing);
    await existing.exec('reset role'); await existing.exec(migration);
    const after = await readAvatarProfile(existing);
    assert.equal(after.avatar_source_photo_id, mainId);
    assert.equal(after.avatar_source_storage_path, 'synthetic/photo-100');
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], key);
  } finally { await existing.close(); }
});
