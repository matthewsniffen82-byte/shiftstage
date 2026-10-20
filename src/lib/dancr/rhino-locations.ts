// Official directory: https://spearmintrhino.com/ (verified 2026-10-20).
// Sample counts describe the showcase only; they are never live staffing counts.
export const RHINO_VENUE_SLUG = "talk-of-the-town";
export const RHINO_ACCENT = "#b8860b";
export const RHINO_LOCATIONS = [
  { key: "las-vegas", label: "Las Vegas, NV", city: "Las Vegas", sampleCount: 96, venueSlug: RHINO_VENUE_SLUG },
  { key: "boise", label: "Boise, ID", city: "Boise", sampleCount: 18 },
  { key: "carter-lake", label: "Carter Lake, IA", city: "Carter Lake", sampleCount: 21 },
  { key: "city-of-industry", label: "City of Industry, CA", city: "City of Industry", sampleCount: 42 },
  { key: "dallas-north", label: "Dallas North, TX", city: "Dallas", sampleCount: 38 },
  { key: "dallas", label: "Dallas, TX", city: "Dallas", sampleCount: 54 },
  { key: "lexington", label: "Lexington, KY", city: "Lexington", sampleCount: 24 },
  { key: "los-angeles", label: "Los Angeles, CA", city: "Los Angeles", sampleCount: 48 },
  { key: "manhattan", label: "Manhattan, NY", city: "New York", sampleCount: 51 },
  { key: "minneapolis", label: "Minneapolis, MN", city: "Minneapolis", sampleCount: 33 },
  { key: "oxnard", label: "Oxnard, CA", city: "Oxnard", sampleCount: 27 },
  { key: "pittsburgh", label: "Pittsburgh, PA", city: "Pittsburgh", sampleCount: 30 },
  { key: "rialto", label: "Rialto, CA", city: "Rialto", sampleCount: 36 },
  { key: "san-jose", label: "San Jose, CA", city: "San Jose", sampleCount: 45 },
  { key: "santa-barbara", label: "Santa Barbara, CA", city: "Santa Barbara", sampleCount: 15 },
  { key: "santa-maria", label: "Santa Maria, CA", city: "Santa Maria", sampleCount: 12 },
  { key: "torrance", label: "Torrance, CA", city: "Torrance", sampleCount: 39 },
  { key: "van-nuys", label: "Van Nuys, CA", city: "Van Nuys", sampleCount: 34 },
  { key: "west-palm-beach", label: "West Palm Beach, FL", city: "West Palm Beach", sampleCount: 57 },
  { key: "birmingham", label: "Birmingham, UK", city: "Birmingham", sampleCount: 25 },
  { key: "leicester", label: "Leicester, UK", city: "Leicester", sampleCount: 16 },
  { key: "london", label: "London, UK", city: "London", sampleCount: 60 },
] as const;

export function rhinoLocation(key: string | null | undefined) {
  return RHINO_LOCATIONS.find(location => location.key === key) || RHINO_LOCATIONS[0];
}
