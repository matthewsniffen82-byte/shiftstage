import { toPublicClubDeal } from "@/src/lib/dancr/public-club-deal";
import { createDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
import { getActiveClubDealsForVenue } from "@/src/lib/dancr/deals";
import { MAX_DANCER_PROFILE_VIDEOS } from "@/src/lib/dancr/media-limits";
import { getVenueProfile } from "@/src/lib/dancr/public";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import { isActiveNfcPresence } from "@/src/lib/dancr/shift-presence";
import { dancerProfileMediaVenue } from "./dancer-profile-media-scope";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerProfile } from "./types";

export async function loadPublicDancerContent(client: SupabaseClient, profile: DancerProfile, venueId?: string) {
  const activeShift = profile.upcomingShifts.find(shift => isActiveNfcPresence(shift));
  const actionShift = activeShift || null;
  let secondaryUnavailable = false;
  const optionalFailure = () => {
    if (!secondaryUnavailable) console.warn("PUBLIC_PROFILE_SECONDARY_CONTENT_UNAVAILABLE");
    secondaryUnavailable = true;
  };
  const [activeDeals, tvVideos, actionVenue] = await Promise.all([
    activeShift?.venueId
      ? getActiveClubDealsForVenue(client, activeShift.venueId).catch(() => { optionalFailure(); return []; })
      : Promise.resolve([]),
    getPublicMyDancrTvFeed(client, {
      city: profile.city,
      dancerId: profile.id,
      venueId: dancerProfileMediaVenue(profile, venueId),
      limit: MAX_DANCER_PROFILE_VIDEOS,
    }).catch(() => { optionalFailure(); return []; }),
    actionShift?.venueSlug
      ? getVenueProfile(client, actionShift.venueSlug).catch(() => { optionalFailure(); return null; })
      : Promise.resolve(null),
  ]);
  const dancerAttributionEligible = Boolean(
    activeShift && activeShift.shiftSource !== "demo_locked",
  );
  const dealAttributionTokens = activeShift && dancerAttributionEligible
    ? Object.fromEntries(activeDeals.map((deal) => [deal.id, createDancerDealAttributionToken({
        dancerId: profile.id,
        venueId: activeShift.venueId,
        dealId: deal.id,
        shiftId: activeShift.id,
      })]))
    : {};

  return { activeDeals: activeDeals.map(toPublicClubDeal), tvVideos: tvVideos.map(video => ({ id: video.id, videoUrl: video.videoUrl, posterUrl: video.posterUrl, durationSeconds: video.durationSeconds, likeCount: video.likeCount, isPinned: video.isPinned, publishedAt: video.publishedAt })), actionVenue, dealAttributionTokens, secondaryUnavailable };
}
