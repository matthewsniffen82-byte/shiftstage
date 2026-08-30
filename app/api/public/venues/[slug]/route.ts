import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getVenueProfile, isApprovedPublicDancerRow } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const client = createAdminSupabaseClient();
    const [venue, { data, error }] = await Promise.all([
      getVenueProfile(client, slug),
      client
        .from("shifts")
        .select("id, dancer_id, shift_date, shift_source, starts_at, ends_at, timezone, status, venues!inner(slug, is_active), dancer_profiles(id, slug, stage_name, status, approved_at, venue_approved_at, disabled_at, verification_status, photo_review_status, is_public)")
        .eq("venues.slug", slug)
        .eq("venues.is_active", true)
        .eq("status", "posted")
        .eq("shift_source", "scheduled")
        .gte("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: true }),
    ]);

    if (!venue) {
      return NextResponse.json({ ok: false, error: "Venue not found." }, { status: 404 });
    }

    if (error) throw error;

    const upcomingShifts = (data || [])
      .map((shift: any) => {
        const dancer = Array.isArray(shift.dancer_profiles) ? shift.dancer_profiles[0] : shift.dancer_profiles;

        return { shift, dancer };
      })
      .filter(({ dancer }: any) => isApprovedPublicDancerRow(dancer))
      .map(({ shift, dancer }: any) => ({
        id: shift.id,
        dancerId: shift.dancer_id,
        dancerSlug: dancer.slug,
        dancerStageName: dancer.stage_name,
        shiftDate: shift.shift_date,
        startsAt: shift.starts_at,
        shiftLabel: formatPublicShiftStart(shift.shift_date || shift.starts_at),
        timezone: shift.timezone,
        status: shift.status,
      }));

    return NextResponse.json({ ok: true, venue, upcomingShifts });
  } catch (error) {
    return apiError(error, "Unable to load venue profile.", 500);
  }
}

function formatPublicShiftStart(startsAt: string) {
  const start = new Date(startsAt);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
  }).format(start);

  return `Scheduled ${date}`;
}
