export const CHECK_IN_RADIUS_FEET = 300;
export const MAX_LOCATION_ACCURACY_METERS = 75;
export const MAX_LOCATION_READING_AGE_MS = 30_000;
export const MAX_LOCATION_READING_FUTURE_SKEW_MS = 10_000;
export const LOCATION_VERIFICATION_TTL_MS = 30 * 60 * 1000;
export const LOCATION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type ClientLocationReading = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
};

export type LocationValidationResult =
  | { ok: true; reading: ClientLocationReading }
  | { ok: false; error: string; code: string };

export function validateClientLocationReading(
  input: Record<string, unknown> | null | undefined,
  now = Date.now(),
): LocationValidationResult {
  const latitude = Number(input?.latitude);
  const longitude = Number(input?.longitude);
  const accuracyMeters = Number(input?.accuracy);
  const capturedAtMs = readCapturedAt(input?.capturedAt);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { ok: false, code: "invalid_coordinates", error: "A valid location reading is required to check in." };
  }

  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) {
    return {
      ok: false,
      code: "missing_accuracy",
      error: "Your phone did not provide location accuracy. Try again with Precise Location enabled.",
    };
  }

  if (accuracyMeters > MAX_LOCATION_ACCURACY_METERS) {
    return {
      ok: false,
      code: "poor_accuracy",
      error: `Location accuracy must be within ${MAX_LOCATION_ACCURACY_METERS} meters. Move near an entrance or window and try again.`,
    };
  }

  if (!Number.isFinite(capturedAtMs)) {
    return {
      ok: false,
      code: "missing_timestamp",
      error: "Your phone did not provide a current location reading. Refresh and try again.",
    };
  }

  if (capturedAtMs < now - MAX_LOCATION_READING_AGE_MS) {
    return { ok: false, code: "stale_location", error: "That location reading is too old. Try checking in again." };
  }

  if (capturedAtMs > now + MAX_LOCATION_READING_FUTURE_SKEW_MS) {
    return {
      ok: false,
      code: "future_location",
      error: "Your phone time does not match the check-in service. Correct it and try again.",
    };
  }

  return {
    ok: true,
    reading: {
      latitude,
      longitude,
      accuracyMeters,
      capturedAt: new Date(capturedAtMs).toISOString(),
    },
  };
}

export function isCurrentLocationVerification(shift: Record<string, unknown> | null | undefined, now = Date.now()) {
  if (!shift || shift.checked_out_at || !shift.checked_in_at) return false;
  if (shift.location_status !== "club_confirmed" && shift.location_status !== "location_confirmed") return false;
  const expiresAt = Date.parse(String(shift.location_verification_expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function locationVerificationRefreshDue(
  shift: Record<string, unknown> | null | undefined,
  now = Date.now(),
) {
  if (!shift || shift.location_status === "club_confirmed") return false;
  const expiresAt = Date.parse(String(shift.location_verification_expires_at || ""));
  return !Number.isFinite(expiresAt) || expiresAt <= now + LOCATION_REFRESH_INTERVAL_MS;
}

function readCapturedAt(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return Date.parse(value);
}
