import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readRankingCandidates } from "@/src/lib/dancr/discovery-service";

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
    const row = readRankingCandidates(result.data).find(candidate => candidate.dancerId === profile.data.id);
    return NextResponse.json({ok:true,eligible:Boolean(row)},{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return apiError(error,"Unable to load profile visibility."); }
}
