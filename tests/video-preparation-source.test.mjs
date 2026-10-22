import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadOriginalVideoForModeration, archivedOriginalStoragePath } from '../src/lib/dancr/media-watermark.ts';

const path = 'owner/profile/video.mp4';
const archive = archivedOriginalStoragePath('mydancr-tv-videos', path);
function storage(result) {
  const reads = [];
  return { reads, client: { storage: { from(bucket) {
    assert.equal(bucket, 'mydancr-tv-videos');
    return { async download(name) { reads.push(name); return name === archive ? result : { data: new Blob(['upload']) }; } };
  } } } };
}
test('a video moderation retry reads the original instead of the prepared watermark', async () => {
  const f = storage({ data: new Blob(['original']) });
  assert.equal((await downloadOriginalVideoForModeration(f.client, path)).toString(), 'original');
  assert.deepEqual(f.reads, [archive]);
});
test('a new video without an archive reads its uploaded source', async () => {
  const f = storage({ error: { statusCode: '404', message: 'not found' } });
  assert.equal((await downloadOriginalVideoForModeration(f.client, path)).toString(), 'upload');
  assert.deepEqual(f.reads, [archive, path]);
});
test('an unavailable archive does not silently review a different file', async () => {
  const error = new Error('Synthetic storage unavailable');
  const f = storage({ error });
  await assert.rejects(downloadOriginalVideoForModeration(f.client, path), error);
  assert.deepEqual(f.reads, [archive]);
});
