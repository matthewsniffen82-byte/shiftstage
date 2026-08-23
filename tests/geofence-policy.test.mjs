import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NFC_COOLDOWN_HOURS,
  NFC_TAP_CYCLE_MS,
  NFC_WORKING_WINDOW_HOURS,
  isActiveNfcPresence,
  isNfcTapCooldownActive,
  nfcNextTapAllowedAt,
} from "../src/lib/dancr/shift-presence.ts";

const now = Date.parse("2026-08-11T12:00:00.000Z");
const tappedAt = new Date(now).toISOString();

test("one dressing-room NFC tap owns a six-hour session and six-hour cooldown", () => {
  assert.equal(NFC_WORKING_WINDOW_HOURS, 6);
  assert.equal(NFC_COOLDOWN_HOURS, 6);
  assert.equal(NFC_TAP_CYCLE_MS, 12 * 60 * 60 * 1000);

  const active = {
    checked_in_at: tappedAt,
    checked_out_at: null,
    location_status: "club_confirmed",
    location_verification_expires_at: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
    nfc_last_tapped_at: tappedAt,
    status: "posted",
  };
  assert.equal(isActiveNfcPresence(active, now + 1), true);
  assert.equal(isNfcTapCooldownActive(active, now + 1), false);
  assert.equal(nfcNextTapAllowedAt(active)?.toISOString(), new Date(now + NFC_TAP_CYCLE_MS).toISOString());

  assert.equal(isActiveNfcPresence(active, now + 6 * 60 * 60 * 1000 + 1), false);
  assert.equal(isNfcTapCooldownActive(active, now + 6 * 60 * 60 * 1000 + 1), true);
  assert.equal(isNfcTapCooldownActive(active, now + NFC_TAP_CYCLE_MS), false);
});

const [checkInRoute, shiftsRoute, nfcRoute, migration, shiftManager, liveShell, lifecycle, cronRoute, publicService, publicVenueRoute] = await Promise.all([
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110005_nfc_shift_lifecycle.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerShiftManager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/shift-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/shift-checkins/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/venues/[slug]/route.ts", import.meta.url), "utf8"),
]);

test("phone-location check-in is retired and cannot activate a dancer", () => {
  assert.match(checkInRoute, /code: "nfc_tap_required"/);
  assert.match(checkInRoute, /status: 410/);
  assert.match(checkInRoute, /dressing-room NFC tag/);
  assert.doesNotMatch(checkInRoute, /process_dancer_location_verification|validateClientLocationReading|latitude|longitude|accuracy/);
  assert.doesNotMatch(checkInRoute, /checked_in_at:/);
});

test("upcoming schedules accept only an approved venue and venue-local date", () => {
  assert.match(shiftsRoute, /requestedShiftDate/);
  assert.match(shiftsRoute, /getScheduleDateWindow/);
  assert.match(shiftsRoute, /createScheduledDancerShift/);
  assert.match(lifecycle, /shift_date: input\.shiftDate/);
  assert.match(lifecycle, /shift_source: "scheduled"/);
  assert.match(lifecycle, /status: "posted"/);
  assert.doesNotMatch(shiftsRoute, /body\.workingStatus|body\.locationStatus|body\.checkedInAt/);
  assert.match(shiftsRoute, /Check out before editing or cancelling an active shift/);
  assert.match(shiftsRoute, /reconcileExpiredDancerShifts/);
  assert.match(publicService, /\.eq\("shift_source", "scheduled"\)[\s\S]*?\.gte\("ends_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(publicVenueRoute, /\.eq\("shift_source", "scheduled"\)/);
  assert.match(publicVenueRoute, /shiftLabel: formatPublicShiftStart\(shift\.shift_date \|\| shift\.starts_at\)/);
});

test("database activation is atomic, affiliation-gated, non-extendable, and globally cooled down", () => {
  assert.match(migration, /create or replace function public\.activate_dancer_shift_from_nfc/);
  assert.match(migration, /security definer/);
  assert.match(migration, /tag\.status = 'active'/);
  assert.match(migration, /tag\.tag_type = 'dressing_room'/);
  assert.match(migration, /affiliation\.status = 'active'/);
  assert.match(migration, /v_working_until timestamptz := clock_timestamp\(\) \+ interval '6 hours'/);
  assert.match(migration, /nfc_last_tapped_at \+ interval '12 hours' > v_now/);
  assert.match(migration, /'reason', 'active_window_not_extendable'/);
  assert.match(migration, /'reason', 'nfc_cooldown_active'/);
  assert.match(migration, /'tapApplied', false/);
  assert.match(migration, /'extended', false/);
  assert.match(migration, /shifts_dancer_nfc_last_tapped_idx/);
  assert.match(migration, /grant execute on function public\.activate_dancer_shift_from_nfc[\s\S]*?to service_role/);
  assert.match(migration, /revoke execute on function public\.process_dancer_location_verification[\s\S]*?from service_role/);
  assert.match(nfcRoute, /registerDancerFromNfc/);
  assert.match(nfcRoute, /This tap did not extend the six-hour session/);
  assert.match(nfcRoute, /cooldown is active/);
});

test("dancer controls explain the physical tap and never request phone coordinates", () => {
  assert.match(shiftManager, /Tap dressing-room NFC to go Working Now/);
  assert.match(shiftManager, /Retaps cannot extend this six-hour session/);
  assert.match(shiftManager, /six-hour cooldown/);
  assert.match(shiftManager, /Upcoming date/);
  assert.match(shiftManager, /No shift time or phone location is collected/);
  assert.doesNotMatch(shiftManager, /navigator\.geolocation|latitude|longitude|accuracy/);

  const verificationHandler = liveShell.match(
    /async function handleShiftVerificationAction\(action, trigger = null, options = \{\}\)[\s\S]*?(?=\n    function renderDancerManagement)/,
  )?.[0] || "";
  assert.match(verificationHandler, /action === "nfc-ready"/);
  assert.match(verificationHandler, /Hold this unlocked phone near the official dressing-room NFC tag/);
  assert.match(verificationHandler, /six-hour cooldown/);
  assert.doesNotMatch(verificationHandler, /requestShiftPosition|navigator\.geolocation|latitude|longitude|accuracy/);
  assert.match(liveShell, /id="shiftDate" type="date" required/);
  assert.doesNotMatch(liveShell, /id="shiftStart"|id="shiftEnd"/);
});

test("server-confirmed NFC presence remains visible and can be ended without shortening the cycle", () => {
  assert.match(shiftManager, /Working Now at \{venueName\(activeShift\)\}/);
  assert.match(shiftManager, /Active until \{formatTime\(activeShift\.location_verification_expires_at\)\}/);
  assert.match(shiftManager, /End Working Now/);
  assert.match(shiftManager, /role="alertdialog"[\s\S]*?End Working Now\?[\s\S]*?Keep working[\s\S]*?Yes, end now/);
  assert.match(shiftManager, /Customers will stop seeing you in Working Now immediately/);
  assert.match(shiftManager, /setWorkingNowStatus\("Working Now ended\. Customers no longer see you in Working Now\."\)/);
  assert.match(shiftManager, /shift-checkin-status\$\{workingNowStatusKind/);
  assert.match(shiftManager, /role="status" aria-live="polite"/);
  assert.match(checkInRoute, /endDancerShift\(admin, dancer\.id, shift, "manual"\)/);
  assert.match(liveShell, /✓ Working Now/);
  assert.match(liveShell, /End Working Now/);
});

test("expired NFC sessions are reconciled by requests and authenticated cron", () => {
  assert.match(lifecycle, /export async function reconcileExpiredDancerShifts/);
  assert.match(lifecycle, /checked_out_at: endedAt/);
  assert.match(lifecycle, /location_verification_expires_at: endedAt/);
  assert.match(lifecycle, /nfc_window_expired/);
  assert.match(cronRoute, /process\.env\.CRON_SECRET/);
  assert.match(cronRoute, /reconcileExpiredDancerShifts/);
});
