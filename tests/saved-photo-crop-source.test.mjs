import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const code = ts.transpileModule(fs.readFileSync('src/lib/dancr/photo-crop-source.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = '00000000-0000-4000-8000-000000000001';
function fixture({ owner = 'profile-a', status = 'approved', missingArchive = false, storageFailure = false } = {}) {
  const exports = {}, filters = {}, downloads = [];
  const original = new Blob(['private-original'], { type: 'image/jpeg' });
  const client = {
    from(table) {
      assert.equal(table, 'dancer_photos');
      const query = { select: () => query, eq: (key, value) => { filters[key] = value; return query; },
        maybeSingle: async () => ({ data: filters.dancer_id === owner && filters.review_status === status ? { storage_path: 'owner/profile/photo.jpg' } : null }) };
      return query;
    },
    storage: { from: bucket => ({ download: async path => {
      downloads.push({ bucket, path });
      if (storageFailure) return { error: { statusCode: 503, message: 'Storage unavailable' } };
      if (missingArchive && bucket === 'private-originals') return { error: { statusCode: 404, message: 'Not found' } };
      return { data: original };
    } }) },
  };
  vm.runInNewContext(code, { exports, require: name => name === 'server-only' ? {} : name.includes('api-error') ? { PublicApiError } : {
    DANCR_ORIGINAL_MEDIA_BUCKET: 'private-originals', archivedOriginalStoragePath: (bucket, path) => `${bucket}/${path}`,
  } });
  return { downloads, filters, original, read: (photoId = id) => exports.ownedPhotoCropSource(client, 'profile-a', photoId) };
}
test('saved crops load the owner’s full-size private image, without downloading a public thumbnail', async () => {
  const f = fixture(); assert.equal(await f.read(), f.original);
  assert.deepEqual(f.filters, { id, dancer_id: 'profile-a', review_status: 'approved' });
  assert.deepEqual(f.downloads, [{ bucket: 'private-originals', path: 'dancer-photos/owner/profile/photo.jpg' }]);
});
for (const options of [{ owner: 'someone-else' }, { status: 'pending' }, { status: 'rejected' }]) {
  test(`saved crop denies ${JSON.stringify(options)} before accessing storage`, async () => {
    const f = fixture(options); await assert.rejects(f.read(), { status: 404 }); assert.equal(f.downloads.length, 0);
  });
}
test('invalid IDs cannot select arbitrary storage paths', async () => {
  const f = fixture(); await assert.rejects(f.read('../other/photo.jpg'), { status: 400 }); assert.equal(f.downloads.length, 0);
});
test('only older photos with no archive fall back to the saved full-size object', async () => {
  const f = fixture({ missingArchive: true }); await f.read(); assert.equal(f.downloads[1].bucket, 'dancer-photos');
  const unavailable = fixture({ storageFailure: true }); await assert.rejects(unavailable.read()); assert.equal(unavailable.downloads.length, 1);
});
