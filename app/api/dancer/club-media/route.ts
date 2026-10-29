import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { isActiveNfcPresence } from "@/src/lib/dancr/shift-presence";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    const [{ data, error }, presence] = await Promise.all([
      admin.rpc("dancer_club_media_statuses", { p_user_id: user.id }),
      admin.from("dancer_profiles").select("shifts(status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venues(id, name))")
        .eq("user_id", user.id).is("disabled_at", null)
        .eq("shifts.status", "posted").is("shifts.checked_out_at", null)
        .eq("shifts.location_status", "club_confirmed").gt("shifts.location_verification_expires_at", new Date().toISOString())
        .order("checked_in_at", { referencedTable: "shifts", ascending: false })
        .limit(1, { referencedTable: "shifts" }).maybeSingle(),
    ]);
    if (error) throw error;
    if (presence.error) throw presence.error;
    const shift = presence.data?.shifts?.[0];
    const venue = Array.isArray(shift?.venues) ? shift.venues[0] : shift?.venues;
    const activeClub = isActiveNfcPresence(shift) && venue ? { id: venue.id, name: venue.name, workingUntil: shift.location_verification_expires_at } : null;
    return NextResponse.json({ ok: true, statuses: data, activeClub, session }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load your club media approvals."); }
}
