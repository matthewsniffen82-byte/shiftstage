import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const source = readFileSync(new URL('../src/lib/dancr/image-moderation.ts', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../app/api/admin/image-moderation/route.ts', import.meta.url), 'utf8');
const lostResponse = { code: '08006', message: 'synthetic response lost' };
function loadModule(code, names, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`${code}\nexport const fixture = { ${names} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require: () => dependencies, Buffer, setTimeout, clearTimeout,
    console: { log() {}, info() {}, warn() {}, error() {} },
  });
  return exports.fixture;
}

function scenario({ failTable, failOperation, failAfterCommit = true, diagnosticFailure = false, recoveryFailure = false, rejectionAfterFailure = false, avatar = false, primary = false, existingPhoto = false } = {}) {
  const assets = new Set(['old', 'new', 'temp']);
  const rows = {
    dancer_profiles: [{ id: 'profile', user_id: 'owner', avatar_storage_path: 'old' }],
    dancer_photos: existingPhoto ? [{ id: 'old-photo', dancer_id: 'profile', storage_path: 'old', is_primary: primary, sort_order: primary ? 0 : 1 }] : [],
    image_moderation_records: [{ id: 'review', user_id: 'owner', status: 'moderating', decision: 'review', temporary_storage_path: 'temp', upload_context: avatar ? 'profile_avatar' : 'profile_gallery:1' }],
  };
  const mutations = [];
  let failed = false;
  const client = { from(table) {
    let operation = 'select', value, single = false;
    const predicates = [];
    const execute = async () => {
      const targets = rows[table].filter(row => predicates.every(p => p(row)));
      if (diagnosticFailure && table === 'image_moderation_records' && operation === 'select') return { data: null, error: lostResponse };
      if (recoveryFailure && table === 'image_moderation_records' && operation === 'update' && value.status === 'moderation_error') throw new Error('synthetic recovery failed');
      const shouldFail = !failed && table === failTable && operation === failOperation;
      if (shouldFail) failed = true;
      if (shouldFail && !failAfterCommit) return { data: null, error: lostResponse };
      let result = targets;
      if (operation === 'insert') { result = [{ id: 'new-photo', ...value }]; rows[table].push(...result); }
      if (operation === 'update') for (const row of targets) Object.assign(row, value);
      if (operation === 'delete') rows[table] = rows[table].filter(row => !targets.includes(row));
      if (operation !== 'select') mutations.push({ table, operation, ids: result.map(row => row.id) });
      if (shouldFail) {
        if (rejectionAfterFailure) Object.assign(rows.image_moderation_records[0], { decision: 'rejected', status: 'rejected' });
        return { data: null, error: lostResponse };
      }
      return { data: single ? result[0] || null : result, error: null };
    };
    const q = {
      select() { return q; },
      insert(v) { operation = 'insert'; value = v; return q; },
      update(v) { operation = 'update'; value = v; return q; },
      delete() { operation = 'delete'; return q; },
      eq(k, v) { predicates.push(row => row[k] === v); return q; },
      neq(k, v) { predicates.push(row => row[k] !== v); return q; },
      is(k, v) { predicates.push(row => row[k] === v); return q; },
      in(k, v) { predicates.push(row => v.includes(row[k])); return q; },
      single() { single = true; return execute(); },
      maybeSingle() { single = true; return execute(); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return q;
  }, storage: { from() { return {
    async remove(paths) { for (const path of paths) assets.delete(path); return { error: null }; },
    async download() { return { data: new Blob(['synthetic']), error: null }; },
  }; } } };
  const dependencies = {
    PublicApiError,
    safeErrorMetadata: error => ({ code: error.code || 'unknown' }),
    uploadResponsiveImage: async () => ({ storagePath: 'new', focalX: 50, focalY: 50 }),
    removeResponsiveImage: async (_client, _bucket, path) => assets.delete(path),
    removeArchivedOriginalMedia: async () => {},
    responsivePublicImage: (_client, _bucket, path) => ({ imageUrl: path }),
    responsiveImageStoragePaths: path => [path],
    validateAndPrepareDancrImage: async () => ({}),
    isProfileAvatarUploadContext: context => context === 'profile_avatar',
    profilePhotoSlotFromUploadContext: () => ({ isPrimary: primary, sortOrder: primary ? 0 : 1 }),
  };
  const functions = loadModule(source, 'approveModeratedUpload, setApprovedDancerAvatar', dependencies);
  Object.assign(dependencies, { ...functions, APPROVED_PHOTO_BUCKET: 'dancer-photos' });
  const admin = loadModule(adminSource, 'approveReviewRecord', dependencies);
  return {
    assets, rows, mutations,
    publish: () => functions.approveModeratedUpload(client, {
      recordId: 'review', profileId: 'profile', userId: 'owner', image: {}, tempPath: 'temp',
      uploadContext: avatar ? 'profile_avatar' : 'profile_gallery:1', isAvatar: avatar,
      isPrimary: primary, sortOrder: primary ? 0 : 1, altText: null,
      evaluation: { decision: 'approved', reasonCodes: [], categoryScores: {}, providerFlagged: false }, categoryFlags: {},
    }),
    adminPublish: () => admin.approveReviewRecord(client, rows.image_moderation_records[0], 'admin', ''),
  };
}

test('diagnostic read failure after confirmed approval does not undo or fail the upload', async () => {
  const s = scenario({ diagnosticFailure: true });
  assert.equal((await s.publish()).decision, 'approved');
  assert.ok(s.assets.has('new'));
  assert.equal(s.rows.image_moderation_records[0].status, 'approved');
  assert.equal(s.rows.dancer_photos[0].storage_path, 'new');
});

for (const avatar of [false, true]) {
  test(`${avatar ? 'avatar' : 'photo'} approval response loss retains committed media and does not downgrade approval`, async () => {
    const s = scenario({ avatar, failTable: 'image_moderation_records', failOperation: 'update' });
    await assert.rejects(s.publish(), error => error === lostResponse);
    assert.ok(s.assets.has('new'));
    assert.equal(s.rows.image_moderation_records[0].status, 'approved');
    assert.equal(avatar ? s.rows.dancer_profiles[0].avatar_storage_path : s.rows.dancer_photos[0].storage_path, 'new');
  });
}

test('lost photo-insert response cannot delete the file referenced by the committed row', async () => {
  const s = scenario({ failTable: 'dancer_photos', failOperation: 'insert' });
  await assert.rejects(s.publish(), error => error === lostResponse);
  assert.equal(s.rows.dancer_photos.length, 1);
  assert.ok(s.assets.has(s.rows.dancer_photos[0].storage_path));
});

for (const failAfterCommit of [false, true]) {
  test(`avatar write failure ${failAfterCommit ? 'after' : 'before'} commit retains files and reports the original failure`, async () => {
    const s = scenario({ avatar: true, failTable: 'dancer_profiles', failOperation: 'update', failAfterCommit });
    await assert.rejects(s.publish(), error => error === lostResponse);
    assert.equal(s.rows.dancer_profiles[0].avatar_storage_path, failAfterCommit ? 'new' : 'old');
    assert.ok(s.assets.has('new'));
    assert.ok(s.assets.has('old'));
    assert.equal(s.mutations.filter(m => m.table === 'dancer_profiles' && m.operation === 'update').length, failAfterCommit ? 1 : 0);
  });
}

test('lost superseded-removal response preserves the acknowledged replacement without failing approval', async () => {
  const s = scenario({ existingPhoto: true, failTable: 'dancer_photos', failOperation: 'delete' });
  assert.equal((await s.publish()).decision, 'approved');
  assert.deepEqual(s.rows.dancer_photos.map(row => row.id), ['new-photo']);
  assert.ok(s.assets.has('new'));
  assert.equal(s.mutations.filter(m => m.operation === 'delete').length, 1);
});

test('primary replacement retires the selected predecessor without broadly demoting other photos', async () => {
  const s = scenario({ primary: true, existingPhoto: true, failTable: 'dancer_photos', failOperation: 'update', failAfterCommit: false });
  assert.equal((await s.publish()).decision, 'approved');
  assert.deepEqual(s.rows.dancer_photos.map(row => row.id), ['new-photo']);
  assert.ok(s.assets.has('new'));
  assert.equal(s.mutations.filter(m => m.table === 'dancer_photos' && m.operation === 'update').length, 0);
});

test('recovery logging failure preserves both approved files and the original database error', async () => {
  const s = scenario({ avatar: true, failTable: 'image_moderation_records', failOperation: 'update', failAfterCommit: false, recoveryFailure: true });
  await assert.rejects(s.publish(), error => error === lostResponse);
  assert.ok(s.assets.has('new'));
  assert.ok(s.assets.has('old'));
  assert.equal(s.rows.dancer_profiles[0].avatar_storage_path, 'new');
});

test('failure bookkeeping cannot replace a concurrent moderator rejection', async () => {
  const s = scenario({ failTable: 'dancer_photos', failOperation: 'insert', rejectionAfterFailure: true });
  await assert.rejects(s.publish(), error => error === lostResponse);
  assert.equal(s.rows.image_moderation_records[0].decision, 'rejected');
  assert.equal(s.rows.image_moderation_records[0].status, 'rejected');
});

for (const avatar of [false, true]) {
  test(`admin ${avatar ? 'avatar' : 'photo'} review response loss retains committed references and files`, async () => {
    const s = scenario({ avatar, failTable: 'image_moderation_records', failOperation: 'update' });
    await assert.rejects(s.adminPublish(), error => error === lostResponse);
    assert.ok(s.assets.has('new'));
    assert.equal(s.rows.image_moderation_records[0].status, 'approved');
    assert.equal(avatar ? s.rows.dancer_profiles[0].avatar_storage_path : s.rows.dancer_photos[0].storage_path, 'new');
  });
}

test('PostgreSQL allows only one avatar update when both requests read the same reference', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create table dancer_profiles(id text primary key, avatar_storage_path text, avatar_updated_at timestamptz)');
    const { setApprovedDancerAvatar } = loadModule(source, 'setApprovedDancerAvatar', { PublicApiError });
    for (const previous of ['old', null, '']) {
      await pg.query('insert into dancer_profiles values ($1,$2,null) on conflict(id) do update set avatar_storage_path=excluded.avatar_storage_path', ['profile', previous]);
      let reads = 0, release;
      const bothRead = new Promise(resolve => { release = resolve; });
      const client = { from(table) {
        assert.equal(table, 'dancer_profiles');
        let update, nullable = false;
        const filters = {};
        const q = {
          select() { return q; },
          update(value) { update = value; return q; },
          eq(key, value) { filters[key] = value; return q; },
          is(key, value) { assert.equal(key, 'avatar_storage_path'); assert.equal(value, null); nullable = true; return q; },
          async maybeSingle() {
            if (!update) {
              const result = await pg.query('select avatar_storage_path from dancer_profiles where id=$1', [filters.id]);
              if (++reads === 2) release();
              await bothRead;
              return { data: result.rows[0] || null, error: null };
            }
            const values = [update.avatar_storage_path, update.avatar_updated_at, filters.id];
            if (!nullable) values.push(filters.avatar_storage_path);
            const result = await pg.query(`update dancer_profiles set avatar_storage_path=$1, avatar_updated_at=$2 where id=$3 and avatar_storage_path ${nullable ? 'is null' : '=$4'} returning id`, values);
            return { data: result.rows[0] || null, error: null };
          },
        };
        return q;
      } };
      const results = await Promise.allSettled(['first', 'second'].map(path => setApprovedDancerAvatar(client, 'profile', path)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = results.find(result => result.status === 'rejected').reason;
      assert.ok(rejected instanceof PublicApiError);
      assert.equal(rejected.status, 409);
      assert.ok(['first', 'second'].includes((await pg.query('select avatar_storage_path from dancer_profiles')).rows[0].avatar_storage_path));
    }
  } finally { await pg.close(); }
});
