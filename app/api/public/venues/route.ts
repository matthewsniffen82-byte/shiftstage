import { NextResponse } from "next/server";
import { formatVenueHours } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const city = url.searchParams.get("city") || "Las Vegas";
    const client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("venues")
      .select("id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at")
      .eq("is_active", true)
      .eq("city", city)
      .order("name", { ascending: true });

    if (error) throw error;

    const venues = (data || []).map((venue) => ({
      id: venue.id,
      slug: venue.slug,
      name: venue.name,
      city: venue.city,
      state: venue.state,
      address: venue.address,
      latitude: venue.latitude,
      longitude: venue.longitude,
      hoursLabel: formatVenueHours(venue.opens_at, venue.closes_at),
    }));

    return NextResponse.json({ ok: true, city, venues });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load venues." },
      { status: 500 },
    );
  }
}
