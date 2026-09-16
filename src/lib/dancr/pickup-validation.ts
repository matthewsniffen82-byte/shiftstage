import { PublicApiError } from "../api-error-policy.ts";

export function pickupUuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid("A valid pickup identifier is required.");
  return value;
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
