const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dancerVisibilityAlertPath(payload: Record<string, unknown>) {
  const venueId = String(payload.venueId || "");
  const club = UUID.test(venueId) ? `?mediaClub=${encodeURIComponent(venueId)}` : "";
  const target = payload.mediaType === "videos" ? "video" : "media";
  return `/dashboard/dancer${club}#dancer-profile-${target}-library`;
}
