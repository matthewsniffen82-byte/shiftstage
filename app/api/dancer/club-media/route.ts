import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { isActiveNfcPresence } from "@/src/lib/dancr/shift-presence";
import { dancerMediaEditor } from "@/src/lib/dancr/dancer-media-editor";
import { getLiveDancerDiscovery } from "@/src/lib/dancr/public";
import { MYDANCR_ALL_CITIES } from "@/src/lib/dancr/markets";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    const [{ data, error }, presence, requirements] = await Promise.all([
      admin.rpc("dancer_club_media_statuses", { p_user_id: user.id }),
      admin.from("dancer_profiles").select("id, is_public, is_incognito, shifts(status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venues(id, name))")
        .eq("user_id", user.id).is("disabled_at", null)
        .eq("shifts.status", "posted").is("shifts.checked_out_at", null)
        .eq("shifts.location_status", "club_confirmed").gt("shifts.location_verification_expires_at", new Date().toISOString())
        .order("checked_in_at", { referencedTable: "shifts", ascending: false })
        .limit(1, { referencedTable: "shifts" }).maybeSingle(),
      admin.rpc("dancer_club_media_requirements", { p_user_id: user.id }),
    ]);
    if (error) throw error;
    if (presence.error) throw presence.error;
    if (requirements.error) throw requirements.error;
    const shift = presence.data?.shifts?.[0];
    const venue = Array.isArray(shift?.venues) ? shift.venues[0] : shift?.venues;
    const activeClub = shift && isActiveNfcPresence(shift) && venue ? { id: venue.id, name: venue.name, workingUntil: shift.location_verification_expires_at } : null;
    const [editor, audience] = await Promise.all([
      dancerMediaEditor(admin, user.id, request, true),
      activeClub && presence.data ? workingAudience(admin, presence.data, activeClub.id) : null,
    ]);
    return NextResponse.json({ ok: true, statuses: data, requirements: requirements.data, activeClub: activeClub && { ...activeClub, audience }, clubs: editor.clubs, session }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load your club media approvals."); }
}

async function workingAudience(admin: ReturnType<typeof createAdminSupabaseClient>, dancer: { id: string; is_public: boolean; is_incognito: boolean }, venueId: string) {
  if (dancer.is_incognito) return { internal: false, publicGrid: false };
  const [roster, grid] = await Promise.allSettled([
    admin.rpc("internal_roster_members", { p_venue_id: venueId }).select("id").eq("id", dancer.id).maybeSingle(),
    dancer.is_public
      ? getLiveDancerDiscovery(admin, MYDANCR_ALL_CITIES, null, [dancer.id], { includeMetrics: false })
        .then(({ tonightDancers }) => tonightDancers.some(card => card.id === dancer.id && card.venueId === venueId))
      : false,
  ]);
  return {
    internal: roster.status === "fulfilled" && !roster.value.error ? roster.value.data?.id === dancer.id : null,
    publicGrid: grid.status === "fulfilled" ? grid.value : null,
  };
}
