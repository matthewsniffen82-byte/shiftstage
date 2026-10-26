import { homeDiscoveryHref } from "./navigation";

// Shared with the standalone homepage. Session storage keeps each browser tab independent.
export const HOME_RETURN_STORAGE_KEY = "mydancr:home-return:v1";

export function canonicalHomeReturnHref(value: string | null | undefined, origin: string) {
  if (!value) return "";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname !== "/" || url.username || url.password
      || url.searchParams.has("venue_preview") || url.searchParams.has("internal_profile")
      || url.searchParams.has("auth") || url.searchParams.has("dancr_dashboard")) return "";
    const requested = url.searchParams.get("view");
    const view = requested === "tv" || requested === "venues" ? requested : "dancers";
    const city = url.searchParams.get("city")?.trim().slice(0, 120) || undefined;
    let href = homeDiscoveryHref(view, city);
    const filter = url.searchParams.get("dancer_filter");
    if (view === "dancers" && (filter === "now" || filter === "not_now")) href += `&dancer_filter=${filter}`;
    return href;
  } catch { return ""; }
}

export function dashboardHomeReturnHref(fallbackHref = "/") {
  const origin = window.location.origin;
  let remembered = "";
  try { remembered = window.sessionStorage.getItem(HOME_RETURN_STORAGE_KEY) || ""; } catch { /* Use the referring homepage when storage is unavailable. */ }
  return canonicalHomeReturnHref(remembered, origin)
    || canonicalHomeReturnHref(document.referrer, origin)
    || canonicalHomeReturnHref(fallbackHref, origin)
    || "/";
}
