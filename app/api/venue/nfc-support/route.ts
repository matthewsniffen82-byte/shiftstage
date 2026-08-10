import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createOwnSupportMessage } from "@/src/lib/dancr/support";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_TYPES = new Set(["damaged", "lost", "relocate", "replacement"]);

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "view_nfc");
    const { data, error } = await (admin as any)
      .from("venue_nfc_support_requests")
      .select("id, nfc_tag_id, request_type, notes, status, created_at, updated_at, resolved_at")
      .eq("venue_id", access.venueId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return noStore({ ok: true, requests: data || [], session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load NFC support requests.");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await createRequestSupabaseContext(request);
    const body = await request.json();
    const requestType = String(body?.requestType || "").trim();
    const tagId = String(body?.tagId || "").trim();
    const notes = String(body?.notes || "").trim();
    if (!REQUEST_TYPES.has(requestType)) {
      return noStore({ ok: false, error: "Choose why this NFC sticker needs support." }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tagId)) {
      return noStore({ ok: false, error: "Choose an assigned NFC sticker." }, 400);
    }
    if (notes.length > 1000) {
      return noStore({ ok: false, error: "Keep NFC support notes under 1,000 characters." }, 400);
    }

    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, auth.user.id, "request_nfc_support");
    const { data: tag, error: tagError } = await (admin as any)
      .from("nfc_tags")
      .select("id, label, tag_type")
      .eq("id", tagId)
      .eq("venue_id", access.venueId)
      .maybeSingle();
    if (tagError) throw tagError;
    if (!tag) return noStore({ ok: false, error: "This NFC sticker is not assigned to your venue." }, 404);

    const { data: supportRequest, error: insertError } = await (admin as any)
      .from("venue_nfc_support_requests")
      .insert({
        venue_id: access.venueId,
        nfc_tag_id: tag.id,
        requested_by_user_id: auth.user.id,
        request_type: requestType,
        notes: notes || null,
      })
      .select("id, nfc_tag_id, request_type, notes, status, created_at")
      .single();
    if (insertError) throw insertError;

    try {
      await createOwnSupportMessage(auth.client, {
        userId: auth.user.id,
        role: "venue",
        subject: `NFC sticker support · ${String(tag.label)}`,
        body: [
          `${access.venueName} requested ${requestType} NFC sticker support.`,
          `Sticker: ${String(tag.label)} (${String(tag.tag_type).replace("_", " ")})`,
          `Request ID: ${String(supportRequest.id)}`,
          notes ? `Notes: ${notes}` : "Notes: None provided.",
        ].join("\n"),
      }, admin);
    } catch (supportError) {
      await (admin as any).from("venue_nfc_support_requests").delete().eq("id", supportRequest.id);
      throw supportError;
    }

    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: auth.user.id,
      actorRole: access.role,
      action: "nfc.support_requested",
      targetType: "nfc_tag",
      targetId: tag.id,
      summary: `${String(tag.label)} was reported for ${requestType} support.`,
      metadata: { requestId: supportRequest.id, requestType },
    });
    return noStore({
      ok: true,
      supportRequest,
      message: "NFC support request sent to MyDancr.",
      session: auth.session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to send this NFC support request.", 400);
  }
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
