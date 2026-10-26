import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getVenueAccess } from "@/src/lib/dancr/venue-access";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";
import { campaignChannels } from "@/src/lib/dancr/venue-campaign-delivery";
import { normalizeCampaignInput } from "@/src/lib/dancr/venue-campaign-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const columns = "id,channel,subject,body,sender_name,sender_address,status,created_at,queued_at,recipient_count,published_count,skipped_count";
async function context(request: Request) {
  const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
  const admin = createAdminSupabaseClient();
  const access = await getVenueAccess(admin, user.id);
  if (!access || !["owner", "manager"].includes(access.role)) throw new PublicApiError("FORBIDDEN", "Only club owners and managers can send updates.", 403);
  return { admin, access, user, session };
}
export async function GET(request: Request) {
  try {
    const { admin, access, session } = await context(request);
    const [audience, history] = await Promise.all([
      admin.rpc("venue_offer_audience", { p_venue: access.venueId }, { count: "exact", head: true }),
      admin.from("venue_update_campaign_summary").select(columns).eq("venue_id", access.venueId).neq("status", "draft").order("created_at", { ascending: false }).limit(20),
    ]);
    for (const result of [audience, history]) if (result.error) throw result.error;
    return NextResponse.json({ ok: true, session, venueName: access.venueName, channels: campaignChannels(), counts: { in_app: audience.count || 0 }, history: history.data || [] }, { headers });
  } catch (error) { return apiError(error, "Unable to load club updates."); }
}
export async function POST(request: Request) {
  try {
    requireSameOriginJsonMutation(request);
    const { admin, access, user, session } = await context(request);
    const input = await readBoundedJsonObject(request, { maxBytes: 24000, invalidMessage: "Invalid club update.", tooLargeMessage: "Message is too long." });
    if (typeof input.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) throw new PublicApiError("INVALID_REQUEST", "Preview your message again.", 400);
    if (input.action === "preview") {
      let content;
      try { content = normalizeCampaignInput(input); } catch (error) { throw new PublicApiError("INVALID_REQUEST", (error as Error).message, 400); }
      const result = await admin.rpc("prepare_venue_update_campaign", { p_id: input.id, p_venue: access.venueId, p_actor: user.id, p_channel: content.channel, p_subject: content.subject, p_body: content.body });
      if (result.error) throw campaignError(result.error);
    } else if (input.action === "send" || input.action === "cancel") {
      const result = await admin.rpc("set_venue_update_campaign_state", { p_id: input.id, p_venue: access.venueId, p_actor: user.id, p_action: input.action });
      if (result.error) throw campaignError(result.error);
    } else throw new PublicApiError("INVALID_REQUEST", "Choose preview, send or cancel.", 400);
    const result = await admin.from("venue_update_campaign_summary").select(columns).eq("id", input.id).eq("venue_id", access.venueId).single();
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, session, campaign: result.data, preview: result.data.body }, { headers });
  } catch (error) { return apiError(error, "Unable to save this club update. Please retry."); }
}
function campaignError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return new PublicApiError("FORBIDDEN", "Your club access has changed. Reload the dashboard.", 403);
  const messages: Record<string, string> = {
    "No subscribers for this channel": "No eligible MyDancr customers follow this club or subscribe to its updates yet.",
    "Club address required": "Ask MyDancr admin to add the club address before publishing offers.",
    "Preview expired": "This preview has expired. Preview the message again.",
    "Campaign changed; preview again": "The message changed. Preview it again.",
    "Campaign not found": "This update is unavailable. Preview it again.",
    "Daily offer limit reached": "You can publish up to three club offers per day. Please try tomorrow.",
    "Too many previews": "Too many previews. Please try again later.",
  };
  return messages[error.message || ""] ? new PublicApiError("INVALID_REQUEST", messages[error.message || ""], 409) : error;
}
