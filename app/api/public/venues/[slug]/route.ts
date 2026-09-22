import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getVenueProfile } from "@/src/lib/dancr/public";
import { PUBLIC_DYNAMIC_CACHE_CONTROL } from "@/src/lib/dancr/public-cache-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

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
      return NextResponse.json({ ok: false, error: "Venue not found." }, { status: 404 });
    }
    const client = createAdminSupabaseClient();
    const venue = await getVenueProfile(client, slug);

    if (!venue) {
      return NextResponse.json({ ok: false, error: "Venue not found." }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, venue, upcomingShifts: [] },
      { headers: { "Cache-Control": PUBLIC_DYNAMIC_CACHE_CONTROL } },
    );
  } catch (error) {
    return apiError(error, "Unable to load venue profile.", 500);
  }
}
