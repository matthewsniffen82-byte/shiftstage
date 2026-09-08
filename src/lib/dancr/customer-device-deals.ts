export const DEVICE_SAVED_DEALS_KEY = "dancrSavedDealPassesV3";
export const DEVICE_SAVED_DEALS_CHANGED_EVENT = "dancr:saved-deals-changed";

type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

export function deviceSavedDealsStorageKey(storage: Pick<Storage, "getItem">): string | null {
  try {
    const session = JSON.parse(storage.getItem("dancrAuthSessionV1") || "null");
    const accountId = text(session?.account?.id) || text(session?.user?.id);
    if (accountId) return `${DEVICE_SAVED_DEALS_KEY}:account:${encodeURIComponent(accountId)}`;
    // Never attach anonymous or legacy V2 bookmarks to an unidentified account.
    if (session?.accessToken) return null;
    return `${DEVICE_SAVED_DEALS_KEY}:anonymous`;
  } catch {
    return null;
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function deviceBookmark(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const dealId = text(item.dealId);
  const venueId = text(item.venueId);
  // Cashier redemption history shares this storage key but is not a bookmark.
  if (!dealId || !venueId || item.serverSaved || item.serverGenerated || item.redemptionToken) return null;
  let venueSlug = text(item.venueSlug);
  let city = text(item.venueCity);
  try {
    const url = new URL(text(item.url), "https://www.mydancr.com");
    venueSlug ||= text(url.searchParams.get("venue"));
    city ||= text(url.searchParams.get("city"));
  } catch {
    // Older device saves may not include a link.
  }
  venueSlug ||= text(item.venueName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const timestamp = typeof item.savedAt === "number" ? item.savedAt : Date.parse(text(item.savedAt));
  return {
    dealId,
    deviceOnly: true,
    sourceType: text(item.sourceType) || "club_page",
    dancerId: text(item.dancerId) || null,
    savedAt: new Date(Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15 ? timestamp : 0).toISOString(),
    venue: { id: venueId, name: text(item.venueName) || "Club", slug: venueSlug, city: city || "Las Vegas" },
    deal: {
      id: dealId,
      title: text(item.title) || "Club Deal",
      description: text(item.description),
      terms: text(item.terms),
      offerType: text(item.offerType),
      // Device storage cannot verify current availability. The UI labels the
      // device copy and opens the venue for up-to-date offer details.
      isActive: false,
    },
  };
}

export type DeviceSavedClubDeal = NonNullable<ReturnType<typeof deviceBookmark>>;

export function readDeviceSavedClubDeals(storage: Pick<Storage, "getItem">): DeviceSavedClubDeal[] {
  try {
    const key = deviceSavedDealsStorageKey(storage);
    if (!key) return [];
    const items: unknown = JSON.parse(storage.getItem(key) || "[]");
    if (!Array.isArray(items)) return [];
    return items.map(deviceBookmark).filter((item): item is DeviceSavedClubDeal => item !== null);
  } catch {
    return [];
  }
}

export function mergeCustomerSavedClubDeals<T extends { dealId: string; savedAt: string }>(
  accountDeals: T[],
  deviceDeals: DeviceSavedClubDeal[],
): Array<T | DeviceSavedClubDeal> {
  const merged = new Map<string, T | DeviceSavedClubDeal>();
  for (const item of [...accountDeals, ...deviceDeals]) {
    // Prefer verified account details when the same deal was saved both ways.
    if (!merged.has(item.dealId)) merged.set(item.dealId, item);
  }
  return [...merged.values()].sort((left, right) =>
    (Date.parse(right.savedAt) || 0) - (Date.parse(left.savedAt) || 0));
}

export function removeDeviceSavedClubDeal(storage: DeviceStorage, dealId: string) {
  // A blocked or unreadable store must not be reported as a successful removal.
  const key = deviceSavedDealsStorageKey(storage);
  if (!key) throw new Error("Your saved deals could not be read. Please try again.");
  const items: unknown = JSON.parse(storage.getItem(key) || "[]");
  if (!Array.isArray(items)) throw new Error("Your saved deals could not be read. Please try again.");
  const remaining = items.filter((item) => deviceBookmark(item)?.dealId !== dealId);
  if (remaining.length !== items.length) storage.setItem(key, JSON.stringify(remaining));
}
