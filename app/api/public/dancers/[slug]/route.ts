import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { restrictClubProfile } from "@/src/lib/dancr/club-media-permissions";
import { getDancerProfile } from "@/src/lib/dancr/public";
import { PRIVATE_NO_STORE_CACHE_CONTROL, PUBLIC_DYNAMIC_CACHE_CONTROL } from "@/src/lib/dancr/public-cache-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import type { DancerProfile, ShiftSummary } from "@/src/lib/dancr/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    if (!PUBLIC_SLUG_PATTERN.test(slug) || slug.length > 100) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }
    const client = createAdminSupabaseClient();
    const venueId = new URL(_request.url).searchParams.get("venue");
    if (venueId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(venueId)) {
      return NextResponse.json({ ok: false, error: "Invalid club." }, { status: 400 });
    }
    const personalProfile = await getDancerProfile(client, slug);
    const profile = personalProfile && venueId ? await restrictClubProfile(client, personalProfile, venueId) : personalProfile;

    if (!profile) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, profile: toPublicDancerProfile(profile) },
      { headers: { "Cache-Control": profile.metricsUnavailable ? PRIVATE_NO_STORE_CACHE_CONTROL : PUBLIC_DYNAMIC_CACHE_CONTROL } },
    );
  } catch (error) {
    return apiError(error, "Unable to load dancer profile.", 500);
  }
}

function toPublicDancerProfile(profile: DancerProfile) {
  const { shiftEndsAt, upcomingShifts, ...publicProfile } = profile;
  return {
    ...publicProfile,
    upcomingShifts: upcomingShifts.map(toPublicShiftSummary),
  };
}

function toPublicShiftSummary(shift: ShiftSummary) {
  const { endsAt, ...publicShift } = shift;
  return publicShift;
}
