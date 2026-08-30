import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { formatVenueHours } from "@/src/lib/dancr/public";
import { PUBLIC_DYNAMIC_CACHE_CONTROL } from "@/src/lib/dancr/public-cache-policy";
import { responsivePublicImage } from "@/src/lib/dancr/responsive-image";
import { verifiedVenueLogoUrl } from "@/src/lib/dancr/venue-branding";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_PUBLIC_VENUES = 200;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const city = (url.searchParams.get("city") || "Las Vegas").trim();
    if (!city || city.length > 80) {
      return NextResponse.json({ ok: false, error: "Choose a valid city." }, { status: 400 });
    }
    const client = createAdminSupabaseClient();
    const { data, error } = await client
      .from("venues")
      .select("id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at, cover_image_storage_path, logo_storage_path")
      .eq("is_active", true)
      .eq("city", city)
      .order("name", { ascending: true })
      .limit(MAX_PUBLIC_VENUES);

    if (error) throw error;

    const venues = (data || []).map((venue) => {
      const coverImage = responsivePublicImage(
        client,
        "venue-cover-images",
        venue.cover_image_storage_path,
      );
      const logoImage = responsivePublicImage(client, "venue-logo-images", venue.logo_storage_path);
      return {
        id: venue.id,
        slug: venue.slug,
        name: venue.name,
        city: venue.city,
        state: venue.state,
        address: venue.address,
        latitude: venue.latitude,
        longitude: venue.longitude,
        hoursLabel: formatVenueHours(venue.opens_at, venue.closes_at),
        coverImageUrl: coverImage?.imageUrl || null,
        coverImageSrcSet: coverImage?.imageSrcSet || null,
        coverImageWidth: coverImage?.imageWidth || null,
        coverImageHeight: coverImage?.imageHeight || null,
        logoImageUrl: logoImage?.imageUrl || verifiedVenueLogoUrl(venue.slug),
        logoImageSrcSet: logoImage?.imageSrcSet || null,
        logoImageWidth: logoImage?.imageWidth || null,
        logoImageHeight: logoImage?.imageHeight || null,
      };
    });

    return NextResponse.json(
      { ok: true, city, venues },
      { headers: { "Cache-Control": PUBLIC_DYNAMIC_CACHE_CONTROL } },
    );
  } catch (error) {
    return apiError(error, "Unable to load venues.", 500);
  }
}
