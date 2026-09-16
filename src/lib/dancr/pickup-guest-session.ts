export const PICKUP_GUEST_STORAGE_KEY = "mydancrGuestPickupsV1";
export type GuestPickupLink = { id: string; key: string; venue: string; savedAt: number };
const memory = new Map<string, GuestPickupLink>();
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export const validGuestKey = (key: string) => /^[a-f0-9]{64}$/.test(key);

export function savedGuestPickups(): GuestPickupLink[] {
  if (typeof window === "undefined") return [];
  const links = new Map<string, GuestPickupLink>();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PICKUP_GUEST_STORAGE_KEY) || "[]");
    if (Array.isArray(stored)) for (const value of stored) {
      if (value && typeof value.id === "string" && validId(value.id) && typeof value.key === "string" && validGuestKey(value.key)
        && typeof value.venue === "string" && Number.isFinite(value.savedAt) && value.savedAt > Date.now() - 30 * 86400000) {
        links.set(value.id, value);
      }
    }
  } catch { /* The current page can still use its private link with storage blocked. */ }
  for (const value of memory.values()) links.set(value.id, value);
  return [...links.values()].filter(value => value.savedAt > Date.now() - 30 * 86400000).sort((a, b) => b.savedAt - a.savedAt).slice(0, 50);
}

export function rememberGuestPickup(value: GuestPickupLink) {
  if (!validId(value.id) || !validGuestKey(value.key)) throw new Error("Invalid private pickup link.");
  const previous = savedGuestPickups();
  try {
    localStorage.setItem(PICKUP_GUEST_STORAGE_KEY, JSON.stringify([value, ...previous.filter(item => item.id !== value.id)].slice(0, 50)));
    memory.delete(value.id);
    return true;
  } catch { memory.set(value.id, value); return false; }
}

export function guestPickupKey(id: string) {
  if (typeof window === "undefined" || !validId(id)) return "";
  const fragment = new URLSearchParams(window.location.hash.slice(1)).get("pickupKey") || "";
  // Fragments are never sent to the server or in HTTP referrers.
  if (window.location.pathname === `/pickups/${id}` && validGuestKey(fragment)) return fragment;
  return savedGuestPickups().find(item => item.id === id)?.key || "";
}

export function guestPickupHref(id: string, key = guestPickupKey(id)) {
  return `/pickups/${id}${validGuestKey(key) ? `#pickupKey=${key}` : ""}`;
}

export function newGuestPickupKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");
}

export function notifyGuestPickupRead() {
  try { localStorage.setItem("mydancrGuestPickupReadV1", String(Date.now())); } catch { /* Other tabs refresh by polling. */ }
  window.dispatchEvent(new Event("mydancr:guest-pickup-read"));
}
