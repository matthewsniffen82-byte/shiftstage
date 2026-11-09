const dashboardPath = /^\/dashboard\/(venue|dancer|customer)(?:\?(alert|mediaClub)=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?(?:#([a-z][a-z0-9-]{0,70}))?$/i;
const vipPath = /^\/vip(?:\?(?:requestId|venueId)=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?(?:#vip-(?:requests|plan))?$/i;
const sections = {
  customer: new Set(["customer-alerts", "customer-support-section"]),
  dancer: new Set(["dancer-main-photo", "dancer-photos-title", "dancer-videos-title", "dancer-profile-media-library",
    "dancer-profile-video-library", "dancer-notifications", "dancer-support"]),
  venue: new Set(["venue-club-deals", "venue-dancer-roster", "venue-guest-list", "venue-media-reviews", "venue-overview",
    "venue-pickups", "venue-publication", "venue-support", "venue-team", "venue-vip", "venue-working-now", "table-requests"]),
};

export function notificationDestinationRole(path: unknown) {
  if (typeof path !== "string" || path.trim() !== path) return null;
  if (vipPath.test(path)) return "customer";
  const match = dashboardPath.exec(path);
  if (!match) return null;
  const [, role, query, section] = match;
  if (role !== "customer" && role !== "dancer" && role !== "venue") return null;
  if (query === "mediaClub" && role !== "dancer") return null;
  return !section || sections[role].has(section) ? role : null;
}
