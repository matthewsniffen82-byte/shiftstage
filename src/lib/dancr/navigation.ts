export const HOME_DISCOVERY_VIEWS = [
  "tonight",
  "dancers",
  "tv",
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

export function homeTvHref(
  city = DEFAULT_CITY,
  options: { videoId?: string; venueId?: string } = {},
) {
  let href = homeDiscoveryHref("tv", city);
  if (options.videoId) {
    href += `&tv_video=${encodeURIComponent(options.videoId)}`;
  }
  if (options.venueId) {
    href += `&tv_venue=${encodeURIComponent(options.venueId)}`;
  }
  return href;
}
