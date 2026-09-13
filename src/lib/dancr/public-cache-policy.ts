export const PRIVATE_NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

// Profile and feed visibility must reflect an account pause on the next request.
export const PUBLIC_DYNAMIC_CACHE_CONTROL =
  PRIVATE_NO_STORE_CACHE_CONTROL;

// City options and other non-personal directory metadata change infrequently.
export const PUBLIC_DIRECTORY_CACHE_CONTROL =
  "public, max-age=60, s-maxage=60, stale-while-revalidate=300";

export function publicTvCacheControl(filter: string) {
  return filter === "following"
    ? PRIVATE_NO_STORE_CACHE_CONTROL
    : PUBLIC_DYNAMIC_CACHE_CONTROL;
}
