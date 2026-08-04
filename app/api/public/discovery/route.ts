import { NextResponse } from "next/server";
import { createDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
import { getActiveClubDealsForVenues } from "@/src/lib/dancr/deals";
import {
  formatVenueHours,
  getLiveDancerDiscovery,
  getPublicVenuePopularity,
} from "@/src/lib/dancr/public";
import { responsivePublicImage } from "@/src/lib/dancr/responsive-image";
import { verifiedVenueLogoUrl } from "@/src/lib/dancr/venue-branding";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCOVERY_CACHE_CONTROL = "public, max-age=0, s-maxage=15, stale-while-revalidate=60";

export async function GET(request: Request) {
  const startedAt = Date.now();
  let city = "Las Vegas";

  try {
    const url = new URL(request.url);
    city = (url.searchParams.get("city") || city).trim();
    if (!city || city.length > 80) {
      return NextResponse.json(
        { ok: false, error: "Choose a valid city." },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }

    const client = createAdminSupabaseClient();
    const [discovery, venueResult] = await Promise.all([
      getLiveDancerDiscovery(client, city),
      client
        .from("venues")
        .select(
          "id, slug, name, city, state, address, phone, website, latitude, longitude, opens_at, closes_at, cover_image_storage_path, qr_code_storage_path, qr_code_label, owner_user_id",
        )
        .eq("is_active", true)
        .eq("city", city)
        .order("name", { ascending: true }),
    ]);

    if (venueResult.error) throw venueResult.error;
    const venueIds = (venueResult.data || []).map((venue) => venue.id);
    const [activeDeals, venuePopularityById] = await Promise.all([
      getActiveClubDealsForVenues(client, venueIds),
      getPublicVenuePopularity(client, venueIds),
    ]);

    const venues = (venueResult.data || []).map((venue) => {
      const coverImage = responsivePublicImage(
        client,
        "venue-cover-images",
        venue.cover_image_storage_path,
      );
      return {
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
        coverImageUrl: coverImage?.imageUrl || null,
        coverImageSrcSet: coverImage?.imageSrcSet || null,
        coverImageWidth: coverImage?.imageWidth || null,
        coverImageHeight: coverImage?.imageHeight || null,
        logoImageUrl: verifiedVenueLogoUrl(venue.slug),
        qrCodeUrl: venue.qr_code_storage_path
          ? client.storage.from("venue-qr-codes").getPublicUrl(venue.qr_code_storage_path).data.publicUrl
          : null,
        qrCodeLabel: venue.qr_code_label || null,
        activeDeal: activeDeals.get(venue.id) || null,
        popularity: venuePopularityById.get(venue.id) || {
          followerCount: 0,
          directionRequests30d: 0,
          profileViews30d: 0,
        },
      };
    });
    const withActiveDeal = (dancer: (typeof discovery.dancers)[number]) => {
      const activeDeal = dancer.venueId ? activeDeals.get(dancer.venueId) || null : null;
      return {
        ...dancer,
        activeDeal,
        dealAttributionToken: activeDeal && dancer.venueId && dancer.shiftId
          ? createDancerDealAttributionToken({
              dancerId: dancer.id,
              venueId: dancer.venueId,
              dealId: activeDeal.id,
              shiftId: dancer.shiftId,
            })
          : null,
      };
    };

    return NextResponse.json(
      {
        ok: true,
        city,
        dancers: discovery.dancers.map(withActiveDeal),
        tonightDancers: discovery.tonightDancers.map(withActiveDeal),
        venues,
      },
      {
        headers: {
          "cache-control": DISCOVERY_CACHE_CONTROL,
          "server-timing": `discovery;dur=${Date.now() - startedAt}`,
        },
      },
    );
  } catch (error) {
    console.error("PUBLIC_DISCOVERY_LOAD_FAILED", {
      city,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "Unable to load live discovery." },
      { status: 500, headers: { "cache-control": "private, no-store" } },
    );
  }
}
