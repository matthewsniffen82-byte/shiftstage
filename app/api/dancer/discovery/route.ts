import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readRankingCandidates } from "@/src/lib/dancr/discovery-service";
import { availabilityBoost, freshnessBoost } from "@/src/lib/dancr/discovery-ranking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request,{role:"dancer"});
    const admin = createAdminSupabaseClient();
    const profile = await admin.from("dancer_profiles").select("id,city").eq("user_id",user.id).single();
    if (profile.error) throw profile.error;
    const result = await admin.rpc("get_discovery_candidates",{p_surface:"grid",p_city:profile.data.city,p_dancer_ids:[profile.data.id]});
    if (result.error) throw result.error;
    const row = readRankingCandidates(result.data)[0];
    const now = Date.now();
    const available = row ? availabilityBoost(row,now) : 0;
    const boosts = row ? [
      available === 1 ? {label:"Verified working now",until:row.availableUntil} : available ? {label:"Upcoming shift",until:row.nextShiftEndsAt} : null,
      freshnessBoost(row.freshAt,now)>0 ? {label:"Fresh approved media",until:new Date(Date.parse(row.freshAt!)+7*86400000).toISOString()} : null,
    ].filter(Boolean) : [];
    return NextResponse.json({ok:true,eligible:Boolean(row),boosts},{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return apiError(error,"Unable to load discovery boosts."); }
}
