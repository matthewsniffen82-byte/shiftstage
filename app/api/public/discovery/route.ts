import { NextResponse } from "next/server";
import { createDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
import { getActiveClubDealListsForVenues } from "@/src/lib/dancr/deals";
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
const MAX_PUBLIC_VENUES = 200;

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
    const discoveryPromise = getLiveDancerDiscovery(client, city);
    const venueDataPromise = (async () => {
      const venueResult = await client
        .from("venues")
        .select(
          "id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at, cover_image_storage_path, logo_storage_path",
        )
        .eq("is_active", true)
        .eq("city", city)
        .order("name", { ascending: true })
        .limit(MAX_PUBLIC_VENUES);
      if (venueResult.error) throw venueResult.error;
      const venueRows = venueResult.data || [];
      const venueIds = venueRows.map((venue) => venue.id);
      const [activeDeals, venuePopularityById] = await Promise.all([
        getActiveClubDealListsForVenues(client, venueIds),
        getPublicVenuePopularity(client, venueIds),
      ]);
      return { venueRows, activeDeals, venuePopularityById };
    })();
    const [discovery, { venueRows, activeDeals, venuePopularityById }] = await Promise.all([
      discoveryPromise,
      venueDataPromise,
    ]);

    const venues = venueRows.map((venue) => {
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
        activeDeals: activeDeals.get(venue.id) || [],
        activeDeal: activeDeals.get(venue.id)?.[0] || null,
        popularity: venuePopularityById.get(venue.id) || {
          followerCount: 0,
          directionRequests30d: 0,
          profileViews30d: 0,
        },
      };
    });
    const withActiveDeal = (dancer: (typeof discovery.dancers)[number]) => {
      const dancerDeals = dancer.venueId ? activeDeals.get(dancer.venueId) || [] : [];
      const activeDeal = dancerDeals[0] || null;
      const commissionEligible = dancer.shiftSource !== "demo_locked";
      const dealAttributionTokens = commissionEligible && dancer.venueId && dancer.shiftId
        ? Object.fromEntries(dancerDeals.map((deal) => [
            deal.id,
            createDancerDealAttributionToken({
              dancerId: dancer.id,
              venueId: dancer.venueId as string,
              dealId: deal.id,
              shiftId: dancer.shiftId as string,
            }),
          ]))
        : {};
      return {
        ...dancer,
        activeDeals: dancerDeals,
        activeDeal,
        dealAttributionTokens,
        dealAttributionToken: commissionEligible && activeDeal && dancer.venueId && dancer.shiftId
          ? dealAttributionTokens[activeDeal.id]
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
