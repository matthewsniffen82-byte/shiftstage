import { loadGalleryGateway } from './helpers/gallery-publication-fixture.mjs';
import assert from 'node:assert/strict';
import * as serverJobs from '../src/lib/server-job.ts';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {loadAvatarGateway} from './helpers/avatar-publication-fixture.mjs';
import {createAvatarDatabase,seedAvatarDatabase,avatarDatabaseClient,readAvatarProfile,putAvatarObject,avatarUser,avatarProfile,avatarTemp} from './helpers/avatar-publication-database.mjs';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const source = readFileSync(new URL('../src/lib/dancr/image-moderation.ts', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../app/api/admin/image-moderation/route.ts', import.meta.url), 'utf8');
const lostResponse = { code: '08006', message: 'synthetic response lost' };
function loadModule(code, names, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`${code}\nexport const fixture = { ${names} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require: () => ({ ...serverJobs, ...dependencies }), Buffer, setTimeout, clearTimeout,
    console: { log() {}, info() {}, warn() {}, error() {} },
  });
  return exports.fixture;
}

function scenario({ failTable, failOperation, failAfterCommit = true, diagnosticFailure = false, recoveryFailure = false, rejectionAfterFailure = false, avatar = false, primary = false, existingPhoto = false } = {}) {
  const assets = new Set(['old', 'new', 'temp']);
  const rows = {
    dancer_profiles: [{ id: 'profile', user_id: 'owner', avatar_storage_path: 'old', avatar_updated_at: '2020-01-01T00:00:00Z' }],
    dancer_photos: existingPhoto ? [{ id: 'old-photo', dancer_id: 'profile', storage_path: 'old', is_primary: primary, sort_order: primary ? 0 : 1 }] : [],
    image_moderation_records: [{ id: 'review', user_id: 'owner', updated_at: '2020-01-01T00:00:00Z', status: 'moderating', decision: 'review', temporary_storage_path: 'temp', upload_context: avatar ? 'profile_avatar' : 'profile_gallery:1' }],
  };
  const mutations = [];
  let failed = false;
  const client = { async rpc(name, input) {
    if(name==='publish_approved_dancer_avatar') {
      const shouldFail=!failed&&failOperation==='update'&&['image_moderation_records','dancer_profiles'].includes(failTable);
      if(shouldFail)failed=true;
      if(shouldFail&&!failAfterCommit)return {data:null,error:lostResponse};
      Object.assign(rows.dancer_profiles[0],{avatar_storage_path:'new',avatar_updated_at:'2020-01-02T00:00:00Z'});
      Object.assign(rows.image_moderation_records[0],{image_id:null,final_storage_path:'new',status:'approved',decision:'approved',updated_at:'2020-01-02T00:00:00Z'});
      mutations.push({table:'dancer_profiles',operation:'update',ids:['profile']});
      if(shouldFail)return {data:null,error:lostResponse};
      return {data:{profile:rows.dancer_profiles[0],record:rows.image_moderation_records[0],already_published:false,previous_storage_path:'old'},error:null};
    }
    assert.equal(name, 'publish_approved_dancer_gallery_photo');
    const shouldFail = !failed && ((failTable === 'image_moderation_records' && failOperation === 'update')
      || (failTable === 'dancer_photos' && ['insert', 'delete'].includes(failOperation)));
    if (shouldFail) failed = true;
    if (shouldFail && (!failAfterCommit || rejectionAfterFailure)) { if (rejectionAfterFailure) Object.assign(rows.image_moderation_records[0], { decision: 'rejected', status: 'rejected' }); return { data: null, error: lostResponse }; }
    const previous = [...rows.dancer_photos];
    const photo = { id: 'new-photo', dancer_id: 'profile', storage_path: 'new', is_primary: primary, sort_order: primary ? 0 : 1, review_status: 'approved' };
    rows.dancer_photos = [photo];
    Object.assign(rows.image_moderation_records[0], { image_id: photo.id, final_storage_path: 'new', status: 'approved', decision: 'approved', updated_at: '2020-01-02T00:00:00Z' });
    if (previous.length) mutations.push({ table: 'dancer_photos', operation: 'delete', ids: previous.map(p => p.id) });
    if (shouldFail) {
      if (rejectionAfterFailure) Object.assign(rows.image_moderation_records[0], { decision: 'rejected', status: 'rejected' });
      return { data: null, error: lostResponse };
    }
    return { data: { photo, record: rows.image_moderation_records[0], already_published: false, superseded_storage_paths: previous.map(p => p.storage_path) }, error: null };
  }, from(table) {
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
      select() { return q; }, limit() { return q; },
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
    // This suite isolates publication acknowledgment; native retirement behavior
    // and transport failures are covered by gallery-storage-cleanup.test.mjs.
    tryRetireGalleryStorageFiles: async (_client, _profileId, path) => { assets.delete(path); return 'retired'; },
    responsivePublicImage: (_client, _bucket, path) => ({ imageUrl: path }),
    responsiveImageStoragePaths: path => [path],
    validateAndPrepareDancrImage: async () => ({}),
    isProfileAvatarUploadContext: context => context === 'profile_avatar',
    profilePhotoSlotFromUploadContext: () => ({ isPrimary: primary, sortOrder: primary ? 0 : 1 }),
  };
  Object.assign(dependencies, loadGalleryGateway(dependencies), loadAvatarGateway());
  const functions = loadModule(source, 'approveModeratedUpload', dependencies);
  Object.assign(dependencies, { ...functions, APPROVED_PHOTO_BUCKET: 'dancer-photos' });
  const admin = loadModule(adminSource, 'approveReviewRecord', dependencies);
  return {
    assets, rows, mutations,
    publish: () => functions.approveModeratedUpload(client, {
      recordId: 'review', expectedUpdatedAt: '2020-01-01T00:00:00Z', profileId: 'profile', userId: 'owner', image: {}, tempPath: 'temp',
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

test('lost atomic insert response cannot delete the file referenced by the committed row', async () => {
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

test('lost atomic replacement response retains committed media without destructive cleanup', async () => {
  const s = scenario({ existingPhoto: true, failTable: 'dancer_photos', failOperation: 'delete' });
  await assert.rejects(s.publish(), error => error === lostResponse);
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
  assert.equal(s.rows.dancer_profiles[0].avatar_storage_path, 'old');
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

test('PostgreSQL accepts only one reservation from two copies of the same original avatar snapshot',async()=>{
  const db=await createAvatarDatabase();
  try {
    await seedAvatarDatabase(db);const client=avatarDatabaseClient(db),gateway=loadAvatarGateway(),expected=await readAvatarProfile(db);
    await putAvatarObject(db,avatarTemp('first'),'dancr-image-moderation-temp');await putAvatarObject(db,avatarTemp('second'),'dancr-image-moderation-temp');
    const results=await Promise.allSettled(['first','second'].map(name=>gateway.createDancerAvatarReview(client,{
      userId:avatarUser,profileId:avatarProfile,expected,temporaryStoragePath:avatarTemp(name),idempotencyKey:name,providerModel:'synthetic',
    })));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
    assert.equal((await readAvatarProfile(db)).avatar_storage_path,expected.avatar_storage_path);
  }finally{await db.close();}
});
