import { serveDancerMedia } from "@/src/lib/dancr/media-delivery";
import { PhotoDeliveryCache } from "@/src/lib/dancr/photo-delivery-cache";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { getPublicEnv } from "@/src/lib/env";
import { getServerEnv } from "@/src/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "pdx1";
export const maxDuration = 60;
const photoCache = new PhotoDeliveryCache();

export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  // Never accept owner/admin preview capabilities through the public embed.
  if (!["photo", "video"].includes(kind) || new URL(request.url).searchParams.has("preview")) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  // The anonymous client rechecks current public RLS on every byte/range request.
  // The delivery service never treats a normal login cookie/token as permission.
  return serveDancerMedia(request, kind as "photo" | "video", {
    publicClient: createServerSupabaseClient(), admin: createAdminSupabaseClient(),
    storageUrl: getPublicEnv().supabaseUrl, serviceKey: getServerEnv("SUPABASE_SERVICE_ROLE_KEY"), photoCache,
  });
}
export const HEAD = GET;
