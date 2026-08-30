import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getDancerProfile } from "@/src/lib/dancr/public";
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
    const profile = await getDancerProfile(createAdminSupabaseClient(), slug);

    if (!profile) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, profile: toPublicDancerProfile(profile) });
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
