export const HOME_DISCOVERY_VIEWS = [
  "tonight",
  "dancers",
  "venues",
  "trending",
] as const;

export type HomeDiscoveryView = (typeof HOME_DISCOVERY_VIEWS)[number];

const DEFAULT_CITY = "Las Vegas";

export function homeDiscoveryHref(
  view: HomeDiscoveryView,
  city = DEFAULT_CITY,
) {
  const normalizedCity = city.trim() || DEFAULT_CITY;
  return `/?city=${encodeURIComponent(normalizedCity)}&view=${encodeURIComponent(view)}`;
}
