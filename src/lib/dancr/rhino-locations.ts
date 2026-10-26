// Official directory: https://spearmintrhino.com/ (verified 2026-10-20).
// Sample counts describe the showcase only; they are never live staffing counts.
// Random counts are saved once so each location keeps a stable 25–80 roster.
export const RHINO_VENUE_SLUG = "talk-of-the-town";
export const RHINO_ACCENT = "#b8860b";
// The live club is separate from the older multi-location showcase.
export function isRhinoVenue(slug: string) {
  return [RHINO_VENUE_SLUG, "spearmint-rhino-las-vegas-demo", "spearmint-rhino"].includes(slug);
}
export const RHINO_LOCATIONS = [
  { key: "las-vegas", label: "Las Vegas, NV", city: "Las Vegas", sampleCount: 49, venueSlug: RHINO_VENUE_SLUG },
  { key: "boise", label: "Boise, ID", city: "Boise", sampleCount: 78 },
  { key: "carter-lake", label: "Carter Lake, IA", city: "Carter Lake", sampleCount: 33 },
  { key: "city-of-industry", label: "City of Industry, CA", city: "City of Industry", sampleCount: 77 },
  { key: "dallas-north", label: "Dallas North, TX", city: "Dallas", sampleCount: 39 },
  { key: "dallas", label: "Dallas, TX", city: "Dallas", sampleCount: 32 },
  { key: "lexington", label: "Lexington, KY", city: "Lexington", sampleCount: 71 },
  { key: "los-angeles", label: "Los Angeles, CA", city: "Los Angeles", sampleCount: 48 },
  { key: "manhattan", label: "Manhattan, NY", city: "New York", sampleCount: 41 },
  { key: "minneapolis", label: "Minneapolis, MN", city: "Minneapolis", sampleCount: 66 },
  { key: "oxnard", label: "Oxnard, CA", city: "Oxnard", sampleCount: 55 },
  { key: "pittsburgh", label: "Pittsburgh, PA", city: "Pittsburgh", sampleCount: 65 },
  { key: "rialto", label: "Rialto, CA", city: "Rialto", sampleCount: 67 },
  { key: "san-jose", label: "San Jose, CA", city: "San Jose", sampleCount: 75 },
  { key: "santa-barbara", label: "Santa Barbara, CA", city: "Santa Barbara", sampleCount: 54 },
  { key: "santa-maria", label: "Santa Maria, CA", city: "Santa Maria", sampleCount: 28 },
  { key: "torrance", label: "Torrance, CA", city: "Torrance", sampleCount: 80 },
  { key: "van-nuys", label: "Van Nuys, CA", city: "Van Nuys", sampleCount: 45 },
  { key: "west-palm-beach", label: "West Palm Beach, FL", city: "West Palm Beach", sampleCount: 56 },
  { key: "birmingham", label: "Birmingham, UK", city: "Birmingham", sampleCount: 44 },
  { key: "leicester", label: "Leicester, UK", city: "Leicester", sampleCount: 63 },
  { key: "london", label: "London, UK", city: "London", sampleCount: 51 },
] as const;

export function rhinoLocation(key: string | null | undefined) {
  return RHINO_LOCATIONS.find(location => location.key === key) || RHINO_LOCATIONS[0];
}
