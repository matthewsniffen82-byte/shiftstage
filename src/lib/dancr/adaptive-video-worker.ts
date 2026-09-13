import type { SupabaseClient } from '@supabase/supabase-js';
import { assertServerJobActive } from '../server-job.ts';
import { encodeAdaptiveVideo } from './adaptive-video-encoder.ts';
import { adaptiveVideoPath, parseAdaptiveVideoManifest } from './adaptive-video-manifest.ts';
import { requireStorageUploadReceipt } from './storage-upload-receipt.ts';

const BUCKET = 'mydancr-tv-videos';
// Additional encoding runs separately from upload/moderation deadlines. The
// published MP4 stays available until all renditions have verified receipts.
export async function prepareAdaptiveVideo(admin: SupabaseClient, id: string) {
  const { data: row, error } = await admin.from('mydancr_tv_videos')
    .select('id,submitted_by,dancer_id,status,storage_path,storage_mime,width,height,moderation_details,updated_at')
    .eq('id', id).eq('status', 'approved').maybeSingle();
  if (error) throw error;
  if (!row || row.storage_mime !== 'video/mp4' || Math.min(row.width, row.height) <= 360) return { state: 'ineligible' };
  if (parseAdaptiveVideoManifest(row.moderation_details?.adaptiveStreaming)) return { state: 'ready' };
  if (row.storage_path !== `${row.submitted_by}/${row.dancer_id}/${row.id}.mp4`
    || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('Adaptive source ownership could not be verified.');
  assertServerJobActive();
  const { data: source, error: sourceError } = await admin.storage.from(BUCKET).download(row.storage_path);
  if (sourceError || !source) throw new Error('The published video is unavailable for adaptive encoding.');
  const { manifest, outputs } = await encodeAdaptiveVideo(Buffer.from(await source.arrayBuffer()), row.width, row.height);
  const paths = outputs.map(output => adaptiveVideoPath(row.storage_path, manifest, output.rendition.name));
  let publicationUncertain = false;
  try {
    for (let index = 0; index < outputs.length; index++) {
      assertServerJobActive();
      const { data, error: uploadError } = await admin.storage.from(BUCKET).upload(paths[index], outputs[index].body,
        { contentType: 'video/mp4', cacheControl: '0', upsert: false });
      if (uploadError) throw uploadError;
      requireStorageUploadReceipt(data, BUCKET, paths[index]);
    }
    assertServerJobActive();
    publicationUncertain = true;
    const { data: updated, error: updateError } = await admin.from('mydancr_tv_videos')
      .update({ moderation_details: { ...(row.moderation_details || {}), adaptiveStreaming: manifest } })
      .eq('id', row.id).eq('status', 'approved').eq('storage_path', row.storage_path).eq('updated_at', row.updated_at)
      .select('id').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) { publicationUncertain = false; throw new Error('The video changed during adaptive encoding.'); }
    return { state: 'generated', bytes: manifest.renditions.map(({ name, bytes }) => ({ name, bytes })) };
  } catch (error) {
    // An ambiguous database response may have committed. Keep those objects;
    // unreferenced generations are private and can be reclaimed by maintenance.
    if (!publicationUncertain) await admin.storage.from(BUCKET).remove(paths).catch(() => undefined);
    throw error;
  }
}
