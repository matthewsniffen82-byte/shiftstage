import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { discoveryContext, DISCOVERY_UUID } from "@/src/lib/dancr/discovery-service";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { isPublicDancerProfileEligible } from "@/src/lib/dancr/profile-approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const events = new Set(["impression","engaged","completed","profile_click","follow","schedule","directions"]);
export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request,{maxBytes:2048,invalidMessage:"Invalid discovery event.",tooLargeMessage:"Discovery event is too large."});
    const session = String(body.session || ""), entity = String(body.entityId || ""), event = String(body.event || "");
    const position = body.position;
    const displayPosition = body.displayPosition ?? position;
    if (!DISCOVERY_UUID.test(session) || !DISCOVERY_UUID.test(entity) || !events.has(event)
      || !Number.isInteger(position) || Number(position)<0 || Number(position)>4999
      || !Number.isInteger(displayPosition) || Number(displayPosition)<0 || Number(displayPosition)>4999) throw invalid();
    const admin = createAdminSupabaseClient();
    const context = await discoveryContext(admin,request);
    if (!context) throw invalid();
    await enforcePublicRequestRateLimit(admin,{namespace:"discovery_events",request,subject:`${context.viewerHash}:${entity}`,
      windowSeconds:60,ipLimit:240,subjectLimit:20});
    const {data:snapshot,error} = await admin.from("discovery_sessions").select("surface,ordered_ids")
      .eq("id",session).eq("viewer_hash",context.viewerHash).gt("expires_at",new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (!snapshot || snapshot.ordered_ids[Number(position)] !== entity) throw invalid();
    let dancerId = entity, duration = 0;
    if (snapshot.surface === "tv") {
      const video = await admin.from("mydancr_tv_videos").select("dancer_id,duration_seconds,status,published_at,expires_at").eq("id",entity).maybeSingle();
      if (video.error) throw video.error;
      if (!video.data || video.data.status!=="approved" || !video.data.published_at || Date.parse(video.data.published_at)>Date.now()
        || Number(video.data.duration_seconds)<1 || Number(video.data.duration_seconds)>30
        || video.data.expires_at && Date.parse(video.data.expires_at)<=Date.now()) throw invalid();
      dancerId = video.data.dancer_id; duration = Number(video.data.duration_seconds);
    } else if (["engaged","completed"].includes(event)) throw invalid();
    const dancer = await admin.from("dancer_profiles").select("id,user_id,status,verification_status,is_public,disabled_at").eq("id",dancerId).maybeSingle();
    if (dancer.error) throw dancer.error;
    if (!isPublicDancerProfileEligible(dancer.data)) throw invalid();
    if (context.userId && context.userId===dancer.data?.user_id) return NextResponse.json({ok:true,recorded:false});
    if (event === "follow") {
      if (!context.userId) throw invalid();
      const follow = await admin.from("follows").select("dancer_id").eq("customer_id",context.userId).eq("dancer_id",dancerId).maybeSingle();
      if (follow.error) throw follow.error;
      if (!follow.data) throw invalid();
    }
    const day = new Date().toISOString().slice(0,10);
    if (event !== "impression") {
      const seen = await admin.from("discovery_events").select("occurred_at").eq("viewer_hash",context.viewerHash)
        .eq("entity_id",entity).eq("surface",snapshot.surface).eq("event_type","impression").eq("occurred_on",day).maybeSingle();
      if (seen.error) throw seen.error;
      if (!seen.data) throw invalid();
      const elapsed = (Date.now()-Date.parse(seen.data.occurred_at))/1000;
      if (event==="completed" && elapsed<duration*.9 || event==="engaged" && elapsed<Math.min(3,duration*.5)) throw invalid();
    }
    const saved = await admin.from("discovery_events").upsert({viewer_hash:context.viewerHash,dancer_id:dancerId,entity_id:entity,
      surface:snapshot.surface,event_type:event,position:displayPosition,occurred_on:day},
      {onConflict:"viewer_hash,entity_id,surface,event_type,occurred_on",ignoreDuplicates:true});
    if (saved.error) throw saved.error;
    return NextResponse.json({ok:true});
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ok:false,error:"Please wait before recording more activity."},
      {status:429,headers:{"retry-after":String(error.retryAfterSeconds)}});
    return apiError(error,"Unable to record discovery activity.");
  }
}
function invalid() { return new PublicApiError("INVALID_REQUEST","Invalid discovery event.",400); }
