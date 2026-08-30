export const PRIVATE_NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

// Live public responses remain fresh while allowing immediate back-navigation
// and short repeat visits to reuse the exact same payload and media URLs.
export const PUBLIC_DYNAMIC_CACHE_CONTROL =
  "public, max-age=10, s-maxage=10, stale-while-revalidate=20";

// City options and other non-personal directory metadata change infrequently.
export const PUBLIC_DIRECTORY_CACHE_CONTROL =
  "public, max-age=60, s-maxage=60, stale-while-revalidate=300";

export function publicTvCacheControl(filter: string) {
  return filter === "following"
    ? PRIVATE_NO_STORE_CACHE_CONTROL
    : PUBLIC_DYNAMIC_CACHE_CONTROL;
}
