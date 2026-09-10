import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const unconfirmed = () => new PublicApiError("UNAVAILABLE", "This tap could not be confirmed. Refresh your dashboard before tapping again.", 503);
const receiptFields = [
  "enrollmentStatus", "enrollmentId", "venueId", "venueName", "venueSlug", "profileActivated", "shiftCheckedIn",
  "id", "dancerId", "dancerUserId", "stageName", "status", "approvedAt", "affiliationActivated", "shiftId",
  "tapApplied", "alreadyWorking", "cooldownActive", "workingUntil", "nextTapAllowedAt", "extended", "switchedVenue",
];

export async function recordDancerTap(client: SupabaseClient, input: {
  tagId: string; dancerUserId: string; sessionId: string; audit: Record<string, unknown>;
}) {
  const { data, error } = await Promise.resolve().then(() => client.rpc("register_and_activate_dancer_tap", {
    p_tag_id: input.tagId, p_dancer_user_id: input.dancerUserId, p_session_id: input.sessionId, p_audit: input.audit,
  })).catch(() => { throw unconfirmed(); });
  if (error) {
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "This tap is unavailable. Check that your dancer account and the club's sticker are active.", 403);
    if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "This tap is no longer available. Refresh your dashboard.", 404);
    if (error.code === "40001") throw new PublicApiError("CONFLICT", "Your check-in changed. Refresh your dashboard before tapping again.", 409);
    if (["22023", "22P02"].includes(error.code)) throw new PublicApiError("INVALID_REQUEST", "Open the club's sticker link again to start a valid tap.", 400);
    throw unconfirmed();
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || !uuid(data.enrollmentId) || !uuid(data.venueId)
    || typeof data.venueName !== "string" || typeof data.venueSlug !== "string") throw unconfirmed();
  if (data.enrollmentStatus === "pending") {
    if (data.profileActivated !== false || data.shiftCheckedIn !== false) throw unconfirmed();
  } else if (data.enrollmentStatus === "completed") {
    if (![data.id, data.dancerId, data.shiftId].every(uuid) || data.dancerUserId !== input.dancerUserId.toLowerCase()
      || typeof data.stageName !== "string" || data.status !== "active" || !date(data.approvedAt)
      || !date(data.workingUntil) || !date(data.nextTapAllowedAt) || data.extended !== false || data.switchedVenue !== false
      || ![data.profileActivated, data.affiliationActivated, data.shiftCheckedIn, data.tapApplied, data.alreadyWorking, data.cooldownActive].every(value => typeof value === "boolean")
      || !((data.shiftCheckedIn && data.tapApplied && !data.alreadyWorking && !data.cooldownActive)
        || (data.shiftCheckedIn && !data.tapApplied && data.alreadyWorking && !data.cooldownActive)
        || (!data.shiftCheckedIn && !data.tapApplied && !data.alreadyWorking && data.cooldownActive))) throw unconfirmed();
  } else throw unconfirmed();
  return Object.fromEntries(receiptFields.filter(field => field in data).map(field => [field, data[field]]));
}
