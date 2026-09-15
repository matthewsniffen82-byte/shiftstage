export function pickupNotificationHref(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = payload as Record<string, unknown>;
  return value.kind === "club_pickup" && typeof value.pickupRequestId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.pickupRequestId)
    ? `/pickups/${value.pickupRequestId}` : "";
}
