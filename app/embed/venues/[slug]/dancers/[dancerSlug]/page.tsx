import { notFound } from "next/navigation";
import { getDancerProfile, getVenueProfile } from "@/src/lib/dancr/public";
import { loadPublicDancerContent } from "@/src/lib/dancr/public-dancer-content";
import { isActiveNfcPresence } from "@/src/lib/dancr/shift-presence";
import { canonicalVenueSlug } from "@/src/lib/dancr/venue-branding";
import { getVenueGuestColors } from "@/src/lib/dancr/venue-guest-colors";
import { RHINO_ACCENT, RHINO_VENUE_SLUG, rhinoLocation } from "@/src/lib/dancr/rhino-locations";
import { venueEmbedMediaUrl, venueEmbedMediaSrcSet } from "@/src/lib/dancr/venue-embed-media.mjs";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import EmbeddedDancerProfile from "./EmbeddedDancerProfile";
import "@/public/profile-media-owner-controls.css";
import "@/public/profile-media-card-feed.css";
import "@/public/profile-actions-compact.css";
import "@/public/dancer-profile-layout.css";
import "./embedded-profile.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "Dancer profile · MyDancr", robots: { index: false, follow: false } };

export default async function EmbeddedDancerPage({ params, searchParams }: {
  params: Promise<{ slug: string; dancerSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: requestedSlug, dancerSlug } = await params;
  const slug = canonicalVenueSlug(requestedSlug);
  if (![slug, dancerSlug].every(value => value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) notFound();
  const client = createAdminSupabaseClient();
  const venue = await getVenueProfile(client, slug);
  const source = venue ? await getDancerProfile(client, dancerSlug) : null;
  // Only publicly visible dancers currently working at this exact club.
  if (!venue || !source || source.venueId !== venue.id || !isActiveNfcPresence(source)) notFound();
  const query = await searchParams;
  const rhino = slug === RHINO_VENUE_SLUG;
  const demo = rhino;
  const location = rhinoLocation(typeof query.location === "string" ? query.location : "");
  if (demo && source.shiftSource !== "demo_locked") notFound();
  const [content, colors] = await Promise.all([
    loadPublicDancerContent(client, source),
    getVenueGuestColors(client, venue.id),
  ]);
  const profile = {
    ...source,
    primaryPhotoUrl: venueEmbedMediaUrl(source.primaryPhotoUrl),
    primaryPhotoSrcSet: venueEmbedMediaSrcSet(source.primaryPhotoSrcSet),
    avatarPhotoUrl: venueEmbedMediaUrl(source.avatarPhotoUrl),
    avatarPhotoSrcSet: venueEmbedMediaSrcSet(source.avatarPhotoSrcSet),
    photos: source.photos.map(photo => ({ ...photo,
      imageUrl: venueEmbedMediaUrl(photo.imageUrl) || "",
      imageSrcSet: venueEmbedMediaSrcSet(photo.imageSrcSet),
    })),
    ...(demo ? {
      city: location.city,
      venueName: "Spearmint Rhino",
      upcomingShifts: source.upcomingShifts.map(shift => ({
        ...shift, venueName: "Spearmint Rhino",
      })),
    } : {}),
  };
  const returnQuery = new URLSearchParams();
  if (rhino) returnQuery.set("location", location.key);
  if (demo) returnQuery.set("demo", "1");
  const returnHref = `/embed/venues/${slug}${returnQuery.size ? `?${returnQuery}` : ""}`;
  // Showcase locations share media, but directions must follow the selected
  // location instead of the Las Vegas venue supplying those sample profiles.
  const destination = demo && location.key !== "las-vegas"
    ? `Spearmint Rhino, ${location.label}`
    : [venue.name, venue.address, venue.city, venue.state].filter(Boolean).join(", ");
  const venueDirectionsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  return <EmbeddedDancerProfile
    profile={profile}
    {...content}
    tvVideos={content.tvVideos.map(video => ({ ...video,
      videoUrl: venueEmbedMediaUrl(video.videoUrl) || "",
      posterUrl: venueEmbedMediaUrl(video.posterUrl),
    }))}
    preview={demo}
    venueSlug={slug}
    returnHref={returnHref}
    venueDirectionsHref={venueDirectionsHref}
    accent={rhino ? RHINO_ACCENT : colors.embedAccent || "#7c3aed"}
  />;
}
