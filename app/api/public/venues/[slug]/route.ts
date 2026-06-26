import { NextResponse } from "next/server";
import { getVenueProfile } from "@/src/lib/dancr/public";
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
    const venue = await getVenueProfile(client, slug);

    if (!venue) {
      return NextResponse.json({ ok: false, error: "Venue not found." }, { status: 404 });
    }

    const { data, error } = await client
      .from("shifts")
      .select("id, dancer_id, starts_at, ends_at, timezone, status, dancer_profiles(id, slug, stage_name, status)")
      .eq("venue_id", venue.id)
      .eq("status", "posted")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true });

    if (error) throw error;

    const upcomingShifts = (data || [])
      .filter((shift: any) => shift.dancer_profiles?.status === "approved")
      .map((shift: any) => ({
        id: shift.id,
        dancerId: shift.dancer_id,
        dancerSlug: shift.dancer_profiles.slug,
        dancerStageName: shift.dancer_profiles.stage_name,
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        timezone: shift.timezone,
        status: shift.status,
      }));

    return NextResponse.json({ ok: true, venue, upcomingShifts });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load venue profile." },
      { status: 500 },
    );
  }
}
