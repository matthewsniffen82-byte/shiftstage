export function pickupNotificationHref(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  return (payload as Record<string, unknown>).kind === "club_shuttle_request" ? "/pickups" : "";
}
