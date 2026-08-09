import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LOCATION_REFRESH_INTERVAL_MS,
  LOCATION_VERIFICATION_TTL_MS,
  MAX_LOCATION_ACCURACY_METERS,
  validateClientLocationReading,
  isCurrentLocationVerification,
  locationVerificationRefreshDue,
} from "../src/lib/dancr/geofence.ts";

const now = Date.parse("2026-08-02T12:00:00.000Z");

test("location readings require fresh, precise device coordinates", () => {
  const valid = validateClientLocationReading(
    { latitude: 36.153595, longitude: -115.161645, accuracy: 12, capturedAt: now - 2_000 },
    now,
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.ok && valid.reading.accuracyMeters, 12);

  const inaccurate = validateClientLocationReading(
    {
      latitude: 36.153595,
      longitude: -115.161645,
      accuracy: MAX_LOCATION_ACCURACY_METERS + 1,
      capturedAt: now,
    },
    now,
  );
  assert.deepEqual(inaccurate.ok ? null : inaccurate.code, "poor_accuracy");

  const stale = validateClientLocationReading(
    { latitude: 36.153595, longitude: -115.161645, accuracy: 12, capturedAt: now - 31_000 },
    now,
  );
  assert.deepEqual(stale.ok ? null : stale.code, "stale_location");
});

test("location-confirmed status expires and becomes due for refresh", () => {
  const shift = {
    checked_in_at: new Date(now - 60_000).toISOString(),
    checked_out_at: null,
    location_status: "location_confirmed",
    location_verification_expires_at: new Date(now + LOCATION_VERIFICATION_TTL_MS).toISOString(),
  };

  assert.equal(isCurrentLocationVerification(shift, now), true);
  assert.equal(locationVerificationRefreshDue(shift, now), false);
  assert.equal(
    locationVerificationRefreshDue(
      { ...shift, location_verification_expires_at: new Date(now + LOCATION_REFRESH_INTERVAL_MS).toISOString() },
      now,
    ),
    true,
  );
  assert.equal(
    isCurrentLocationVerification(
      { ...shift, location_verification_expires_at: new Date(now - 1).toISOString() },
      now,
    ),
    false,
  );
});

const [checkInRoute, shiftsRoute, migration, lockMigration, dashboard, liveShell, lifecycle, cronRoute, venueService] = await Promise.all([
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608020002_production_geofence_checkins.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608020003_lock_shift_verification_fields.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/shift-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/shift-checkins/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue.ts", import.meta.url), "utf8"),
]);

test("check-in and refresh are atomic server-only database operations", () => {
  assert.match(checkInRoute, /createAdminSupabaseClient\(\)/);
  assert.match(checkInRoute, /\.rpc\("process_dancer_location_verification"/);
  assert.match(checkInRoute, /validateClientLocationReading/);
  assert.match(checkInRoute, /p_accuracy_meters: validation\.reading\.accuracyMeters/);
  assert.match(checkInRoute, /p_captured_at: validation\.reading\.capturedAt/);
  assert.doesNotMatch(checkInRoute, /\.from\("shifts"\)[\s\S]*?\.update\(\{[\s\S]*?checked_in_at/);
});

test("the general shift endpoint cannot mutate verification state", () => {
  assert.doesNotMatch(shiftsRoute, /body\.workingStatus|body\.locationStatus|body\.checkedInAt/);
  assert.match(shiftsRoute, /Check out before editing or cancelling an active shift/);
  assert.match(shiftsRoute, /reconcileExpiredDancerShifts/);
});

test("database verification enforces distance, accuracy, freshness, audit, and overnight shifts", () => {
  assert.match(migration, /create or replace function public\.process_dancer_location_verification/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\.process_dancer_location_verification[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.process_dancer_location_verification[\s\S]*?to service_role/);
  assert.match(migration, /for update/);
  assert.match(migration, /p_accuracy_meters[^\n]*> 75/);
  assert.match(migration, /interval '30 seconds'/);
  assert.match(migration, /v_distance_feet > 300/);
  assert.match(migration, /v_now < v_shift\.starts_at or v_now > v_shift\.ends_at/);
  assert.match(migration, /v_expires_at := least\(v_shift\.ends_at, v_now \+ interval '30 minutes'\)/);
  assert.match(migration, /insert into public\.shift_location_events/);
});

test("database clients cannot forge verification state or read raw device coordinates", () => {
  assert.match(lockMigration, /create or replace function public\.enforce_shift_verification_server_only/);
  assert.match(lockMigration, /if auth\.role\(\) = 'service_role'/);
  assert.match(lockMigration, /before insert or update on public\.shifts/);
  assert.match(lockMigration, /new\.checked_in_at is distinct from old\.checked_in_at/);
  assert.match(lockMigration, /new\.last_location_latitude is distinct from old\.last_location_latitude/);
  assert.match(lockMigration, /An active checked-in shift cannot be edited or cancelled/);
  assert.match(lockMigration, /revoke select on public\.shifts from anon, authenticated/);
  assert.doesNotMatch(lockMigration, /grant select \([\s\S]*?checkin_latitude/);
  assert.doesNotMatch(lockMigration, /grant select \([\s\S]*?last_location_longitude/);
  assert.match(venueService, /from\("shifts"\)[\s\S]*?\.select\("id", \{ count: "exact", head: true \}\)/);
});

test("every client sends GPS quality data and refreshes expiring proof", () => {
  for (const source of [dashboard, liveShell]) {
    assert.match(source, /accuracy/);
    assert.match(source, /capturedAt/);
    assert.match(source, /refresh/);
  }
  assert.match(dashboard, /LOCATION_REFRESH_INTERVAL_MS/);
  assert.match(liveShell, /SHIFT_LOCATION_REFRESH_INTERVAL_MS/);
  assert.match(liveShell, /if \(!profile\.shiftId \|\| !isDancerSession\(\)\)[\s\S]*?throw new Error\("Sign in to your dancer account before updating a live shift\."\)/);
});

test("a server-confirmed check-in remains visible on the check-in button", () => {
  assert.match(dashboard, /if \(data\.shift\)[\s\S]*?setShifts[\s\S]*?data\.shift\.id[\s\S]*?\.\.\.data\.shift/);
  assert.match(dashboard, /activeShift && isCheckedInToActiveShift[\s\S]*?className="check-in-confirmation"[\s\S]*?✓ Checked in/);
  assert.match(dashboard, /canCheckOutOfShift\(shift\)[\s\S]*?className="check-in-confirmation"[\s\S]*?✓ Checked in/);
  assert.match(liveShell, /checkedIn && !ended \? '<button class="mini-action checked-in-confirmation"[\s\S]*?✓ Checked in<\/button>'/);
  assert.match(liveShell, /if \(data\?\.shift\) applyShiftState\(profile, data\.shift\)[\s\S]*?Checked in\. Your shift can now appear in Working Now\./);
});

test("an out-of-range check-in stays rejected and shows an accessible on-screen explanation", () => {
  assert.match(migration, /if v_distance_feet > 300 then/);
  assert.match(migration, /'outside_geofence'/);
  assert.match(migration, /'requiredRadiusFeet', 300/);
  assert.match(dashboard, /data\?\.code === "outside_geofence"/);
  assert.match(liveShell, /data\?\.code === "outside_geofence"/);
  for (const source of [dashboard, liveShell]) {
    assert.match(source, /You can't check in yet\. You're outside the club's/);
    assert.match(source, /Move closer to the club and try again/);
    assert.doesNotMatch(source, /Your phone currently shows you about/);
  }
  assert.match(dashboard, /role=\{checkInTone === "error" \? "alert" : "status"\}/);
  assert.match(dashboard, /aria-live=\{checkInTone === "error" \? "assertive" : "polite"\}/);
  assert.match(liveShell, /shift-checkin-feedback\$\{shiftCheckInTone/);
  assert.match(liveShell, /shiftCheckInTone === "error" \? "alert" : "status"/);
});

test("the live dashboard separates a rejected geofence alert from a clear retry button", () => {
  assert.match(liveShell, /function apiRequestError[\s\S]*?error\.code = typeof data\?\.code === "string" \? data\.code : "request_failed"/);
  assert.match(liveShell, /throw apiRequestError\(data\)/);
  assert.match(liveShell, /class="mini-action \$\{checkInRejected \? "check-in-retry" : "primary"\}"[\s\S]*?\$\{checkInRejected \? "Try check-in again" : "Check in now"\}/);
  assert.match(liveShell, /\.shift-action-grid \.mini-action\.check-in-retry::before[\s\S]*?content: "↻"/);
  assert.doesNotMatch(liveShell, /Outside club range — try again/);
  assert.doesNotMatch(liveShell, /mini-action\.check-in-rejected/);
  assert.match(liveShell, /const triggerLabel = trigger\?\.querySelector\("span"\) \|\| trigger/);
  assert.match(liveShell, /if \(triggerLabel\) triggerLabel\.textContent = action === "end" \? "Ending shift\.\.\." : action === "refresh" \? "Verifying location\.\.\." : "Checking location\.\.\."/);
  assert.doesNotMatch(liveShell, /trigger\.textContent = action === "end"/);
  assert.match(liveShell, /action\.classList\.toggle\("is-retry", checkInRejected\)/);
  assert.match(liveShell, /if \(detail\) detail\.textContent = checkInRejected[\s\S]*?shiftCheckInMessage/);
  assert.match(liveShell, /<div class="shift-action-grid">[\s\S]*?<div class="shift-verification-copy shift-checkin-feedback/);
  assert.match(liveShell, /if \(actionSucceeded\)[\s\S]*?else \{[\s\S]*?renderShiftVerificationPanel\(\)/);
  assert.match(liveShell, /getElementById\("shiftCheckInStatus"\)\?\.scrollIntoView/);
});

test("mobile check-in cannot remain pending indefinitely", () => {
  assert.match(liveShell, /const watchdogId = window\.setTimeout\([\s\S]*?"location_timeout"[\s\S]*?15000\)/);
  assert.match(liveShell, /Location access is off\. Allow location for mydancr\.com in your browser settings/);
  assert.match(liveShell, /postAuthenticatedJson\("\/api\/dancer\/shifts\/check-in", payload, \{ timeoutMs: 20000 \}\)/);
  assert.match(liveShell, /\{ timeoutMs: 20000 \}/);
  assert.match(liveShell, /timeoutError\.code = "request_timeout"/);
});

test("expired checked-in shifts are reconciled by requests and an authenticated cron", () => {
  assert.match(lifecycle, /export async function reconcileExpiredDancerShifts/);
  assert.match(lifecycle, /checked_out_at: endedAt/);
  assert.match(lifecycle, /location_verification_expires_at: endedAt/);
  assert.match(cronRoute, /process\.env\.CRON_SECRET/);
  assert.match(cronRoute, /reconcileExpiredDancerShifts/);
});
