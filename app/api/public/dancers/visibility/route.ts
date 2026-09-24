import { publicDancerVisibility } from "@/src/lib/dancr/public-dancer-visibility";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return publicDancerVisibility(request, createServerSupabaseClient());
}
