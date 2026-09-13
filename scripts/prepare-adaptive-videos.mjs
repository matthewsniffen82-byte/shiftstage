import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { prepareAdaptiveVideo } from '../src/lib/dancr/adaptive-video-worker.ts';
import { adaptiveVideoPath, parseAdaptiveVideoManifest } from '../src/lib/dancr/adaptive-video-manifest.ts';
import { adaptiveVideoCodecs } from '../src/lib/dancr/adaptive-video-codecs.ts';
import { runWithServerJob, withServerJobFetch } from '../src/lib/server-job.ts';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const repairCodecs = process.argv.includes('--repair-codecs');
const selected = process.argv.find(value => value.startsWith('--id='))?.slice(5);
const limit = Math.min(100, Math.max(1, Number(process.argv.find(value => value.startsWith('--limit='))?.slice(8) || 12)));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: withServerJobFetch(fetch) } });
let query = admin.from('mydancr_tv_videos').select('id,width,height,storage_path,updated_at,moderation_details').eq('status', 'approved')
  .eq('storage_mime', 'video/mp4').order('published_at', { ascending: false }).limit(limit);
if (selected) query = query.eq('id', selected);
const { data, error } = await query;
if (error) throw new Error('Adaptive video inventory failed.');
const results = [];
for (const row of data || []) {
  const manifest = parseAdaptiveVideoManifest(row.moderation_details?.adaptiveStreaming);
  if (repairCodecs ? !manifest || manifest.renditions.every(rendition => rendition.codecs)
    : manifest || Math.min(row.width, row.height) <= 360) continue;
  if (!apply) { results.push({ id: row.id, state: 'pending' }); continue; }
  try {
    const result = await runWithServerJob(async () => {
      if (!repairCodecs) return prepareAdaptiveVideo(admin, row.id);
      for (const rendition of manifest.renditions) {
        if (rendition.codecs) continue;
        const object = adaptiveVideoPath(row.storage_path, manifest, rendition.name).split('/').map(encodeURIComponent).join('/');
        const response = await withServerJobFetch(fetch)(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/mydancr-tv-videos/${object}`, {
          headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `bytes=0-${rendition.initBytes - 1}` }, redirect: 'error',
        });
        if (response.status !== 206 || Number(response.headers.get('content-length')) !== rendition.initBytes) {
          await response.body?.cancel(); throw new Error('Adaptive initialization range unavailable.');
        }
        rendition.codecs = adaptiveVideoCodecs(Buffer.from(await response.arrayBuffer()));
      }
      if (!parseAdaptiveVideoManifest(manifest)) throw new Error('Invalid repaired manifest.');
      const { data, error } = await admin.from('mydancr_tv_videos').update({ moderation_details: { ...row.moderation_details, adaptiveStreaming: manifest } })
        .eq('id', row.id).eq('status', 'approved').eq('storage_path', row.storage_path).eq('updated_at', row.updated_at).select('id').maybeSingle();
      if (error || !data) throw new Error('Adaptive codec publication unconfirmed.');
      return { state: 'codecs-repaired' };
    }, 180_000);
    results.push({ id: row.id, ...result });
    console.log(JSON.stringify(results.at(-1)));
  } catch {
    results.push({ id: row.id, state: 'failed' }); process.exitCode = 1;
    console.error(JSON.stringify(results.at(-1)));
  }
}
console.log(JSON.stringify({ apply, results }));
