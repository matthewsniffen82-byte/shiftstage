// Prepare and quality-check private Android MP4 copies. --apply publishes only
// reviewed candidates and appends metadata using a compare-and-swap update.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'ffmpeg-static';
import { createMobileVideoPlayback } from '../../src/lib/dancr/video-mobile-encoding.ts';
import { mobileVideoStoragePath, parseMobileVideoPlayback } from '../../src/lib/dancr/video-mobile-playback.ts';
import { requireStorageUploadReceipt } from '../../src/lib/dancr/storage-upload-receipt.ts';
import { runMediaProcess } from '../../src/lib/dancr/media-process.ts';
import { LOCAL_VIDEO_INPUT_OPTIONS } from '../../src/lib/dancr/local-video-input.ts';

process.loadEnvFile('.env.local');
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
assert.ok(output && /^\.next-[a-zA-Z0-9_./-]+$/.test(output) && !output.split('/').includes('..'), 'Use an ignored workspace output directory');
const onlyId = process.argv.find(arg => arg.startsWith('--id='))?.slice(5);
assert.ok(!onlyId || /^[a-f0-9-]{36}$/.test(onlyId), 'Invalid video ID');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const publicClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const bucket = 'mydancr-tv-videos';
const fields = 'id,storage_path,storage_mime,width,height,status,updated_at,moderation_details';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
const manifestPath = path.join(output, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{"videos":[]}'; throw error; }));
const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const record = async id => {
  const result = await admin.from('mydancr_tv_videos').select(fields).eq('id', id).single();
  if (result.error) throw result.error;
  return result.data;
};
const download = async storagePath => {
  const result = await admin.storage.from(bucket).download(storagePath);
  if (result.error) throw result.error;
  assert.ok(result.data);
  return Buffer.from(await result.data.arrayBuffer());
};
const visible = async id => {
  const result = await publicClient.from('mydancr_tv_videos').select('id').eq('id', id).maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
};

if (process.argv.includes('--apply')) {
  for (const entry of manifest.videos.filter(entry => entry.accepted && !entry.applied && (!onlyId || entry.row.id === onlyId))) {
    assert.ok(await visible(entry.row.id), 'Video is no longer public');
    assert.deepEqual(await record(entry.row.id), entry.row, 'Video changed after preparation');
    assert.equal(hash(await download(entry.row.storage_path)), entry.sourceHash, 'Full-quality source changed');
    const bytes = await readFile(path.join(output, entry.row.id, 'mobile.mp4'));
    assert.equal(hash(bytes), entry.mobileHash, 'Candidate changed after quality check');
    assert.ok(parseMobileVideoPlayback(entry.metadata));
    const mobilePath = mobileVideoStoragePath(entry.row.storage_path);
    const uploaded = await admin.storage.from(bucket).upload(mobilePath, bytes, { contentType: 'video/mp4', cacheControl: '3600', upsert: true });
    if (uploaded.error) throw uploaded.error;
    requireStorageUploadReceipt(uploaded.data, bucket, mobilePath);
    const changed = await admin.from('mydancr_tv_videos')
      .update({ moderation_details: { ...entry.row.moderation_details, mobilePlayback: entry.metadata } })
      .eq('id', entry.row.id).eq('updated_at', entry.row.updated_at).eq('storage_path', entry.row.storage_path).eq('status', 'approved')
      .select('id,moderation_details').maybeSingle();
    if (changed.error) throw changed.error;
    assert.equal(changed.data?.id, entry.row.id, 'Video changed while publishing the derivative');
    assert.deepEqual(changed.data.moderation_details.mobilePlayback, entry.metadata);
    entry.applied = true; await save();
    console.log(JSON.stringify({ event: 'mobile_video.applied', id: entry.row.id, bytes: bytes.length }));
  }
} else {
  let query = publicClient.from('mydancr_tv_videos').select('id').order('id').limit(250);
  if (onlyId) query = query.eq('id', onlyId);
  const result = await query;
  if (result.error) throw result.error;
  assert.ok(result.data.length < 250, 'Scope a larger library into explicit batches');
  for (const { id } of result.data) {
    if (manifest.videos.some(entry => entry.row.id === id)) continue;
    const row = await record(id);
    const source = await download(row.storage_path);
    const mobile = await createMobileVideoPlayback(source, row.storage_mime === 'video/webm' ? 'video/webm' : 'video/mp4', row.width, row.height);
    const entry = { row, sourceBytes: source.length, sourceHash: hash(source), accepted: false, applied: false };
    if (mobile) {
      const directory = path.join(output, id);
      await mkdir(directory, { recursive: true });
      const sourcePath = path.join(directory, 'source.mp4'), mobilePath = path.join(directory, 'mobile.mp4');
      await writeFile(sourcePath, source); await writeFile(mobilePath, mobile.bytes);
      const qualityPath = path.join(directory, 'quality.json').replaceAll('\\', '/');
      // Compare at the delivered mobile resolution, preserving frame rate,
      // aspect ratio, audio and the already-applied watermark.
      const graph = `[0:v]scale=${mobile.metadata.width}:${mobile.metadata.height}:flags=lanczos,setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[dist];[dist][ref]libvmaf=n_subsample=3:n_threads=2:log_fmt=json:log_path=${qualityPath}`;
      await runMediaProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...LOCAL_VIDEO_INPUT_OPTIONS, '-i', sourcePath, ...LOCAL_VIDEO_INPUT_OPTIONS, '-i', mobilePath, '-filter_complex', graph, '-an', '-f', 'null', '-'], { timeoutMs: 120000, timeoutMessage: 'Mobile quality check timed out', failureMessage: 'Mobile quality check failed' });
      const quality = JSON.parse(await readFile(qualityPath, 'utf8')).pooled_metrics.vmaf;
      Object.assign(entry, { metadata: mobile.metadata, mobileHash: hash(mobile.bytes), quality, accepted: quality.mean >= 95 && quality.min >= 88 });
    }
    manifest.videos.push(entry); await save();
    console.log(JSON.stringify({ event: 'mobile_video.prepared', id, accepted: entry.accepted, sourceBytes: source.length, mobileBytes: entry.metadata?.bytes, qualityMean: entry.quality?.mean }));
  }
}
