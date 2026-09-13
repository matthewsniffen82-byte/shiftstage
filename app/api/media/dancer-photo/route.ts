import { serveDancerMedia } from '@/src/lib/dancr/media-delivery';
import { createAdminSupabaseClient } from '@/src/lib/supabase/admin';
import { createServerSupabaseClient } from '@/src/lib/supabase/server';
import { getPublicEnv } from '@/src/lib/env';
import { getServerEnv } from '@/src/lib/server-env';
import { PhotoDeliveryCache } from '@/src/lib/dancr/photo-delivery-cache';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const photoCache = new PhotoDeliveryCache();
export async function GET(request: Request) {
  return serveDancerMedia(request, 'photo', { publicClient: createServerSupabaseClient(), admin: createAdminSupabaseClient(),
    storageUrl: getPublicEnv().supabaseUrl, serviceKey: getServerEnv('SUPABASE_SERVICE_ROLE_KEY'), photoCache });
}
export const HEAD = GET;
