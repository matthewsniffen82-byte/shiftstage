import 'server-only';
import { after } from 'next/server';
import { createAdminSupabaseClient } from '../supabase/admin';
import { runWithServerJob, serverJobRemainingMs } from '../server-job';
import { safeErrorMetadata } from '../security/safe-error-metadata';
import { prepareAdaptiveVideo } from './adaptive-video-worker';

// Independent of the moderation job: failure never changes an approval or the
// playable original. Deadline cancellation also reaches encoding and Storage.
export async function prepareAdaptiveVideoInBackground(id: string, budgetMs = 100_000) {
  const timeout = Math.floor(Math.min(100_000, budgetMs));
  if (timeout < 10_000) return;
  try {
    const result = await runWithServerJob(() => prepareAdaptiveVideo(createAdminSupabaseClient(), id), timeout);
    console.info(JSON.stringify({ event: 'mydancr_tv.adaptive_preparation', videoId: id, state: result.state }));
  } catch (error) {
    console.warn(JSON.stringify({ event: 'mydancr_tv.adaptive_preparation_failed', videoId: id, ...safeErrorMetadata(error) }));
  }
}

export function scheduleAdaptiveVideoPreparation(id: string, budgetMs = 100_000) {
  after(() => prepareAdaptiveVideoInBackground(id, budgetMs));
}

// The existing daily recovery cron also picks up uploads whose after-response
// worker was interrupted. Keep each run bounded; regular approvals start at once.
export function scheduleAdaptiveVideoRecovery() {
  after(async () => {
    try {
      await runWithServerJob(async () => {
        const admin = createAdminSupabaseClient();
        const { data, error } = await admin.from('mydancr_tv_videos').select('id')
          .eq('status', 'approved').eq('storage_mime', 'video/mp4').gt('width', 360).gt('height', 360)
          .is('moderation_details->adaptiveStreaming', null).order('published_at', { ascending: false }).limit(2);
        if (error) throw error;
        for (const row of data || []) {
          if (serverJobRemainingMs() < 15_000) break;
          await prepareAdaptiveVideoInBackground(row.id, serverJobRemainingMs());
        }
      }, 100_000);
    } catch (error) {
      console.warn(JSON.stringify({ event: 'mydancr_tv.adaptive_recovery_failed', ...safeErrorMetadata(error) }));
    }
  });
}
