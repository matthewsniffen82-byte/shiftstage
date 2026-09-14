import { serveDancerMedia } from '@/src/lib/dancr/media-delivery';
import { createAdminSupabaseClient } from '@/src/lib/supabase/admin';
import { createServerSupabaseClient } from '@/src/lib/supabase/server';
import { getPublicEnv } from '@/src/lib/env';
import { getServerEnv } from '@/src/lib/server-env';
export const runtime = 'nodejs';
// Keep authorized byte-range requests beside the Supabase project in us-west-2.
export const preferredRegion = 'pdx1';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const started = performance.now();
  const response = await serveDancerMedia(request, 'video', { publicClient: createServerSupabaseClient(), admin: createAdminSupabaseClient(),
    storageUrl: getPublicEnv().supabaseUrl, serviceKey: getServerEnv('SUPABASE_SERVICE_ROLE_KEY') });
  // Expose only delivery timing and the public hosting region, never lookup data.
  response.headers.set('Server-Timing', `video;dur=${Math.round(performance.now() - started)};desc="${process.env.VERCEL_REGION || 'local'}"`);
  return response;
}
export const HEAD = GET;
