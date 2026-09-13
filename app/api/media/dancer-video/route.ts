import { serveDancerMedia } from '@/src/lib/dancr/media-delivery';
import { createAdminSupabaseClient } from '@/src/lib/supabase/admin';
import { createServerSupabaseClient } from '@/src/lib/supabase/server';
import { getPublicEnv } from '@/src/lib/env';
import { getServerEnv } from '@/src/lib/server-env';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  return serveDancerMedia(request, 'video', { publicClient: createServerSupabaseClient(), admin: createAdminSupabaseClient(),
    storageUrl: getPublicEnv().supabaseUrl, serviceKey: getServerEnv('SUPABASE_SERVICE_ROLE_KEY') });
}
export const HEAD = GET;
