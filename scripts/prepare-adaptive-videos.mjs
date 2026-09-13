import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { prepareAdaptiveVideo } from '../src/lib/dancr/adaptive-video-worker.ts';
import { parseAdaptiveVideoManifest } from '../src/lib/dancr/adaptive-video-manifest.ts';
import { runWithServerJob, withServerJobFetch } from '../src/lib/server-job.ts';
nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const selected = process.argv.find(value => value.startsWith('--id='))?.slice(5);
const limit = Math.min(100, Math.max(1, Number(process.argv.find(value => value.startsWith('--limit='))?.slice(8) || 12)));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: withServerJobFetch(fetch) } });
let query = admin.from('mydancr_tv_videos').select('id,width,height,moderation_details').eq('status', 'approved')
  .eq('storage_mime', 'video/mp4').order('published_at', { ascending: false }).limit(limit);
if (selected) query = query.eq('id', selected);
const { data, error } = await query;
if (error) throw new Error('Adaptive video inventory failed.');
const results = [];
for (const row of data || []) {
  if (parseAdaptiveVideoManifest(row.moderation_details?.adaptiveStreaming) || Math.min(row.width, row.height) <= 360) continue;
  if (!apply) { results.push({ id: row.id, state: 'pending' }); continue; }
  try {
    const result = await runWithServerJob(() => prepareAdaptiveVideo(admin, row.id), 180_000);
    results.push({ id: row.id, ...result });
    console.log(JSON.stringify(results.at(-1)));
  } catch {
    results.push({ id: row.id, state: 'failed' }); process.exitCode = 1;
    console.error(JSON.stringify(results.at(-1)));
  }
}
console.log(JSON.stringify({ apply, results }));
