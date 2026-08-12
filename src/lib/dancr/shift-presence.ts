export const NFC_WORKING_WINDOW_HOURS = 6;
export const NFC_WORKING_WINDOW_MS = NFC_WORKING_WINDOW_HOURS * 60 * 60 * 1000;
export const NFC_COOLDOWN_HOURS = 6;
export const NFC_COOLDOWN_MS = NFC_COOLDOWN_HOURS * 60 * 60 * 1000;
export const NFC_TAP_CYCLE_MS = NFC_WORKING_WINDOW_MS + NFC_COOLDOWN_MS;
export const NFC_EXPIRY_WARNING_MINUTES = 30;

type PresenceShift = {
  checked_in_at?: string | null;
  checkedInAt?: string | null;
  checked_out_at?: string | null;
  checkedOutAt?: string | null;
  location_status?: string | null;
  locationStatus?: string | null;
  location_verification_expires_at?: string | null;
  locationVerificationExpiresAt?: string | null;
  nfc_last_tapped_at?: string | null;
  nfcLastTappedAt?: string | null;
  status?: string | null;
};

export function isActiveNfcPresence(shift: PresenceShift | null | undefined, now = Date.now()) {
  if (!(shift?.checked_in_at || shift?.checkedInAt) || shift.checked_out_at || shift.checkedOutAt || shift.status === "cancelled") return false;
  if ((shift.location_status || shift.locationStatus) !== "club_confirmed") return false;
  const expiresAt = new Date(shift.location_verification_expires_at || shift.locationVerificationExpiresAt || "").getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function nfcPresenceMinutesRemaining(shift: PresenceShift | null | undefined, now = Date.now()) {
  if (!isActiveNfcPresence(shift, now)) return 0;
  const expiresAt = new Date(shift?.location_verification_expires_at || shift?.locationVerificationExpiresAt || "").getTime();
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

export function isNfcPresenceNearExpiry(shift: PresenceShift | null | undefined, now = Date.now()) {
  const minutes = nfcPresenceMinutesRemaining(shift, now);
  return minutes > 0 && minutes <= NFC_EXPIRY_WARNING_MINUTES;
}

export function nfcNextTapAllowedAt(shift: PresenceShift | null | undefined) {
  const tappedAt = shift?.nfc_last_tapped_at || shift?.nfcLastTappedAt || shift?.checked_in_at || shift?.checkedInAt || "";
  const tappedAtMs = Date.parse(tappedAt);
  return Number.isFinite(tappedAtMs) ? new Date(tappedAtMs + NFC_TAP_CYCLE_MS) : null;
}

export function isNfcTapCooldownActive(shift: PresenceShift | null | undefined, now = Date.now()) {
  const nextAllowedAt = nfcNextTapAllowedAt(shift)?.getTime() ?? Number.NaN;
  return Number.isFinite(nextAllowedAt) && nextAllowedAt > now && !isActiveNfcPresence(shift, now);
}
