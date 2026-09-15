import { PublicApiError } from "../api-error-policy.ts";
import { PICKUP_STATUS_LABELS } from "./pickup-domain.ts";

export function pickupUuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid("A valid pickup identifier is required.");
  return value;
}
function text(body: Record<string, unknown>, key: string, max: number, min = 0) {
  const value = body[key] ?? "";
  if (typeof value !== "string" || value.trim().length < min || value.length > max) invalid(`Check ${key}.`);
  return value.trim();
}
function allowedKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) invalid("Unexpected pickup request fields.");
}
export function pickupCreateArgs(body: Record<string, unknown>) {
  allowedKeys(body, ["requestId", "venueId", "location", "locationDetails", "partySize", "notes", "consentVersion"]);
  if (typeof body.partySize !== "number" || !Number.isInteger(body.partySize) || body.partySize < 1 || body.partySize > 30) invalid("Party size must be between 1 and 30.");
  return { p_id: pickupUuid(body.requestId), p_venue_id: pickupUuid(body.venueId), p_location: text(body, "location", 300, 3),
    p_party_size: body.partySize, p_details: text(body, "locationDetails", 500), p_notes: text(body, "notes", 1000), p_consent_version: text(body, "consentVersion", 50, 1) };
}
export function pickupCommand(id: string, body: Record<string, unknown>) {
  const p_id = pickupUuid(id);
  switch (body.action) {
    case "consent":
      allowedKeys(body, ["action", "version"]);
      return { name: "pickup_accept_consent", args: { p_id, p_version: text(body, "version", 50, 1) } };
    case "message":
      allowedKeys(body, ["action", "messageId", "text"]);
      return { name: "pickup_send_message", args: { p_id, p_message_id: pickupUuid(body.messageId), p_text: text(body, "text", 2000, 1) } };
    case "status": {
      allowedKeys(body, ["action", "status", "expectedStatus", "reason"]);
      const p_status = text(body, "status", 30, 1), p_expected_status = text(body, "expectedStatus", 30, 1);
      if (!Object.hasOwn(PICKUP_STATUS_LABELS, p_status) || !Object.hasOwn(PICKUP_STATUS_LABELS, p_expected_status)) invalid("Invalid pickup status.");
      return { name: "pickup_set_status", args: { p_id, p_status, p_expected_status, p_reason: text(body, "reason", 500) } };
    }
    case "read":
      allowedKeys(body, ["action", "sequence"]);
      if (typeof body.sequence !== "number" || !Number.isSafeInteger(body.sequence) || body.sequence < 0) invalid("Invalid message position.");
      return { name: "pickup_mark_read", args: { p_id, p_sequence: body.sequence } };
    case "report":
      allowedKeys(body, ["action", "reason", "details"]);
      return { name: "pickup_report_conversation", args: { p_id, p_reason: text(body, "reason", 40, 1), p_details: text(body, "details", 1000) } };
    case "admin_note":
      allowedKeys(body, ["action", "note"]);
      return { name: "pickup_admin_note", args: { p_id, p_note: text(body, "note", 1000, 3) } };
    default: return invalid("Unknown pickup action.");
  }
}
export function pickupPageOffset(value: string | null) {
  if (value === null) return 0;
  if (!/^\d{1,5}$/.test(value) || Number(value) > 10000) invalid("Invalid page.");
  return Number(value);
}
export function pickupDate(value: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid("Invalid date filter.");
  return value;
}
function invalid(message: string): never { throw new PublicApiError("INVALID_REQUEST", message, 400); }
