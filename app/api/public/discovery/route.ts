import { directoryFilter, directoryVenue, parseDiscoveryCursor } from "@/src/lib/dancr/discovery-pagination";
import { toPublicClubDeal } from "@/src/lib/dancr/public-club-deal";
import { getRankedDirectoryPage } from "@/src/lib/dancr/public-directory";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { findAvailableMyDancrCity, isAllMyDancrCities, MYDANCR_ALL_CITIES } from "@/src/lib/dancr/markets";
import { NextResponse } from "next/server";
import { createDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
import { getActiveClubDealListsForVenues } from "@/src/lib/dancr/deals";
import {
  formatVenueHours,
  getPublicVenuePopularity,
} from "@/src/lib/dancr/public";
import { PRIVATE_NO_STORE_CACHE_CONTROL, PUBLIC_DYNAMIC_CACHE_CONTROL } from "@/src/lib/dancr/public-cache-policy";
import { responsivePublicImage } from "@/src/lib/dancr/responsive-image";
import { verifiedVenueLogoUrl } from "@/src/lib/dancr/venue-branding";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PUBLIC_VENUES = 200;

export async function GET(request: Request) {
  const startedAt = Date.now();
  let city = "Las Vegas";

  try {
    const url = new URL(request.url);
    city = (url.searchParams.get("city") ?? city).trim();
    const availableCity = findAvailableMyDancrCity(city);
    if (city.length > 80 || (!availableCity && !isAllMyDancrCities(city))) {
      return NextResponse.json(
        { ok: false, error: "Choose a valid city." },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }
    city = availableCity || MYDANCR_ALL_CITIES;

    let cursor: string, filter: "all" | "now" | "not_now", venueId: string | undefined;
    try {
      cursor = parseDiscoveryCursor(url.searchParams.get("cursor"), city);
      filter = directoryFilter(url.searchParams.get("filter"));
      venueId = directoryVenue(url.searchParams.get("venue"));
    }
    catch {
      return NextResponse.json({ ok: false, error: "Invalid discovery cursor." },
        { status: 400, headers: { "cache-control": "private, no-store" } });
    }
    const client = createAdminSupabaseClient();
    const discoveryPromise = getRankedDirectoryPage(client, request, { city, cursor, filter, venueId });
    const venueDataPromise = (async () => {
      let venueQuery = client
        .from("venues")
        .select(
          "id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at, cover_image_storage_path, logo_storage_path",
        )
        .eq("is_active", true)
        .eq("has_active_club_deal", true)
        .order("name", { ascending: true })
        .limit(isAllMyDancrCities(city) ? MAX_PUBLIC_VENUES * 4 : MAX_PUBLIC_VENUES);
      if (!isAllMyDancrCities(city)) venueQuery = venueQuery.eq("city", city);
      const venueResult = await venueQuery;
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
    const rankedDancers = discovery.dancers;
    const rankedTonight = discovery.tonightDancers;

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
        activeDeals: (activeDeals.get(venue.id) || []).map(toPublicClubDeal),
        activeDeal: activeDeals.get(venue.id)?.[0] ? toPublicClubDeal(activeDeals.get(venue.id)![0]) : null,
        popularity: venuePopularityById.get(venue.id) || {
          followerCount: 0,
          directionRequests30d: 0,
          profileViews30d: 0,
        },
      };
    });
    const withActiveDeal = (dancer: (typeof discovery.dancers)[number]) => {
      const dancerDeals = (dancer.venueId ? activeDeals.get(dancer.venueId) || [] : []).map(toPublicClubDeal);
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
        nextCursor: discovery.nextCursor,
        dancers: rankedDancers.map(withActiveDeal),
        tonightDancers: rankedTonight.map(withActiveDeal),
        venues,
      },
      {
        headers: {
          "cache-control": discovery.dancers.some(dancer => dancer.metricsUnavailable)
            || [...venuePopularityById.values()].some(venue => venue.metricsUnavailable)
            ? PRIVATE_NO_STORE_CACHE_CONTROL : PUBLIC_DYNAMIC_CACHE_CONTROL,
          ...(discovery.cookie ? { "set-cookie": discovery.cookie } : {}),
          "server-timing": `discovery;dur=${Date.now() - startedAt}`,
        },
      },
    );
  } catch (error) {
    if (error instanceof PublicApiError) return NextResponse.json({ ok: false, error: error.message },
      { status: error.status, headers: { "cache-control": PRIVATE_NO_STORE_CACHE_CONTROL } });
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait before refreshing discovery." },
      { status: 429, headers: { "cache-control": PRIVATE_NO_STORE_CACHE_CONTROL, "retry-after": String(error.retryAfterSeconds) } });
    console.error("PUBLIC_DISCOVERY_LOAD_FAILED", {
      ...safeErrorMetadata(error),
    });
    return NextResponse.json(
      { ok: false, error: "Unable to load live discovery." },
      { status: 500, headers: { "cache-control": "private, no-store" } },
    );
  }
}
