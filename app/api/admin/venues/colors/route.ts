import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { getVenueGuestColors, parseVenueGuestColors } from "@/src/lib/dancr/venue-guest-colors";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
function venueId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a club.", 400);
  }
  return value;
}
async function authorize(request: Request) {
  const context = await createRequestSupabaseContext(request);
  await requireAdmin(context.client, context.user.id);
  return { ...context, admin: createAdminSupabaseClient() };
}
async function requireVenue(admin: ReturnType<typeof createAdminSupabaseClient>, id: string) {
  const { data, error } = await admin.from("venues").select("id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new PublicApiError("NOT_FOUND", "Club not found.", 404);
}
export async function GET(request: Request) {
  try {
    const { admin, session } = await authorize(request);
    const id = venueId(new URL(request.url).searchParams.get("venueId"));
    await requireVenue(admin, id);
    return NextResponse.json({ ok: true, venueId: id, colors: await getVenueGuestColors(admin, id), session }, { headers });
  } catch (error) { return apiError(error, "Unable to load guest colors."); }
}
export async function PATCH(request: Request) {
  try {
    const { admin, user, session } = await authorize(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 1024, invalidMessage: "Invalid color settings.", tooLargeMessage: "Color settings are too large." });
    const id = venueId(body.venueId);
    const colors = parseVenueGuestColors(body.colors);
    await requireVenue(admin, id);
    const { data, error } = await admin.from("venue_guest_colors").upsert({ venue_id: id,
      internal_accent: colors.internalAccent, embed_accent: colors.embedAccent, updated_by: user.id, updated_at: new Date().toISOString(),
    }, { onConflict: "venue_id" }).select("venue_id,internal_accent,embed_accent").single();
    if (error) throw error;
    if (data?.venue_id !== id || data.internal_accent !== colors.internalAccent || data.embed_accent !== colors.embedAccent) throw new Error("Color save could not be confirmed.");
    return NextResponse.json({ ok: true, venueId: id, colors, session }, { headers });
  } catch (error) { return apiError(error, "Unable to save guest colors."); }
}
