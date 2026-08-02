const VENUE_LOGO_BY_SLUG: Readonly<Record<string, string>> = Object.freeze({
  "centerfolds-cabaret-las-vegas": "/venue-logos/centerfolds-cabaret-las-vegas.png",
  "chicas-bonitas": "/venue-logos/chicas-bonitas.jpg",
  "crazy-horse-3": "/venue-logos/crazy-horse-3.png",
  "deja-vu-showgirls": "/venue-logos/deja-vu-showgirls-las-vegas.png",
  "deja-vu-showgirls-las-vegas": "/venue-logos/deja-vu-showgirls-las-vegas.png",
  "hustler-club-las-vegas": "/venue-logos/hustler-club-las-vegas.png",
  "little-darlings": "/venue-logos/little-darlings-las-vegas.png",
  "little-darlings-las-vegas": "/venue-logos/little-darlings-las-vegas.png",
  "palomino-club": "/venue-logos/palomino-club.svg",
  "peppermint-hippo-las-vegas": "/venue-logos/peppermint-hippo-las-vegas.svg",
  "play-it-again-sams": "/venue-logos/play-it-again-sams.svg",
  "sapphire-las-vegas": "/venue-logos/sapphire-las-vegas.png",
  "spearmint-rhino": "/venue-logos/spearmint-rhino-las-vegas.png",
  "spearmint-rhino-las-vegas": "/venue-logos/spearmint-rhino-las-vegas.png",
  "talk-of-the-town": "/venue-logos/talk-of-the-town.png",
  "the-library-gentlemens-club": "/venue-logos/the-library-gentlemens-club.png",
  "treasures-las-vegas": "/venue-logos/treasures-las-vegas.png",
});

export function verifiedVenueLogoUrl(slug?: string | null) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  return VENUE_LOGO_BY_SLUG[normalizedSlug] || null;
}

export const verifiedVenueLogoSlugs = Object.freeze(Object.keys(VENUE_LOGO_BY_SLUG));
