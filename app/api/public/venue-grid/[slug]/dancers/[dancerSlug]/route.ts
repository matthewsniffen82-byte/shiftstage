import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getDancerProfile, getVenueProfile } from "@/src/lib/dancr/public";
import { loadPublicDancerContent } from "@/src/lib/dancr/public-dancer-content";
import { isActiveNfcPresence } from "@/src/lib/dancr/shift-presence";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { venueEmbedMediaUrl, venueEmbedMediaSrcSet } from "@/src/lib/dancr/venue-embed-media.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: { params: Promise<{ slug: string; dancerSlug: string }> }) {
  try {
    const { slug, dancerSlug } = await context.params;
    if (![slug, dancerSlug].every(value => value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) {
      return NextResponse.json({ ok: false, error: "Profile unavailable." }, { status: 404, headers });
    }
    const client = createAdminSupabaseClient();
    const venue = await getVenueProfile(client, slug);
    const profile = venue ? await getDancerProfile(client, dancerSlug) : null;
    if (!venue || !profile || profile.venueId !== venue.id || !isActiveNfcPresence(profile)) {
      return NextResponse.json({ ok: false, error: "This dancer is no longer working here or their profile is unavailable." }, { status: 404, headers });
    }
    const content = await loadPublicDancerContent(client, profile);
    return NextResponse.json({ ok: true, venue: { id: venue.id, slug: venue.slug, name: venue.name }, profile: {
      id: profile.id, slug: profile.slug, stageName: profile.stageName, city: profile.city,
      primaryPhotoUrl: venueEmbedMediaUrl(profile.primaryPhotoUrl),
      photos: profile.photos.map(photo => ({ id: photo.id, imageUrl: venueEmbedMediaUrl(photo.imageUrl), imageSrcSet: venueEmbedMediaSrcSet(photo.imageSrcSet) })),
      videos: content.tvVideos.map(video => ({ id: video.id, videoUrl: venueEmbedMediaUrl(video.videoUrl), posterUrl: venueEmbedMediaUrl(video.posterUrl) })),
      secondaryUnavailable: content.secondaryUnavailable,
    } }, { headers });
  } catch (error) { return apiError(error, "Unable to load this profile.", 500); }
}
