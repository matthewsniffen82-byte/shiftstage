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
      .select("id, slug, name, city, state, address, phone, website, latitude, longitude, opens_at, closes_at, qr_code_storage_path, qr_code_label")
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
      phone: venue.phone,
      website: venue.website,
      latitude: venue.latitude,
      longitude: venue.longitude,
      hoursLabel: formatVenueHours(venue.opens_at, venue.closes_at),
      qrCodeUrl: venue.qr_code_storage_path
        ? client.storage.from("venue-qr-codes").getPublicUrl(venue.qr_code_storage_path).data.publicUrl
        : null,
      qrCodeLabel: venue.qr_code_label || null,
    }));

    return NextResponse.json({ ok: true, city, venues });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load venues." },
      { status: 500 },
    );
  }
}
