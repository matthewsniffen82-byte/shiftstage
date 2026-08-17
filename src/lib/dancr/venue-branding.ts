const VENUE_LOGO_BY_SLUG: Readonly<Record<string, string>> = Object.freeze({
  "centerfolds-cabaret-las-vegas": "/venue-logos/fictional/neon-ember.svg",
  "chicas-bonitas": "/venue-logos/fictional/velvet-orbit.svg",
  "crazy-horse-3": "/venue-logos/fictional/electric-mirage.svg",
  "deja-vu-showgirls": "/venue-logos/fictional/afterglow-social.svg",
  "deja-vu-showgirls-las-vegas": "/venue-logos/fictional/violet-hour.svg",
  "hustler-club-las-vegas": "/venue-logos/fictional/lunar-house.svg",
  "little-darlings": "/venue-logos/fictional/prism-room.svg",
  "little-darlings-las-vegas": "/venue-logos/fictional/golden-halo.svg",
  "palomino-club": "/venue-logos/fictional/midnight-current.svg",
  "peppermint-hippo-las-vegas": "/venue-logos/fictional/nova-lounge.svg",
  "play-it-again-sams": "/venue-logos/fictional/silver-circuit.svg",
  "sapphire-las-vegas": "/venue-logos/fictional/blue-ember.svg",
  "spearmint-rhino": "/venue-logos/fictional/radiant-room.svg",
  "spearmint-rhino-las-vegas": "/venue-logos/fictional/moonline-social.svg",
  "talk-of-the-town": "/venue-logos/fictional/echo-house.svg",
  "the-library-gentlemens-club": "/venue-logos/fictional/starlight-club.svg",
  "treasures-las-vegas": "/venue-logos/fictional/aurora-room.svg",
});

export function verifiedVenueLogoUrl(slug?: string | null) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  return VENUE_LOGO_BY_SLUG[normalizedSlug] || null;
}

export function isFictionalVenueBranding(slug?: string | null) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  return Boolean(VENUE_LOGO_BY_SLUG[normalizedSlug]);
}

export function isFictionalVenueTravelPreviewOnly(venue?: {
  slug?: string | null;
}) {
  return isFictionalVenueBranding(venue?.slug);
}

export const verifiedVenueLogoSlugs = Object.freeze(Object.keys(VENUE_LOGO_BY_SLUG));
