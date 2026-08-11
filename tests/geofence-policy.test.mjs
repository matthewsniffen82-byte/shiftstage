import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isCurrentLocationVerification } from "../src/lib/dancr/geofence.ts";

const now = Date.parse("2026-08-11T12:00:00.000Z");

test("server-confirmed NFC proof expires for both club and legacy location statuses", () => {
  const base = { checked_in_at: new Date(now - 1000).toISOString(), checked_out_at: null };
  for (const location_status of ["club_confirmed", "location_confirmed"]) {
    assert.equal(isCurrentLocationVerification({ ...base, location_status, location_verification_expires_at: new Date(now + 1000).toISOString() }, now), true);
    assert.equal(isCurrentLocationVerification({ ...base, location_status, location_verification_expires_at: new Date(now - 1).toISOString() }, now), false);
  }
});

const [checkInRoute, shiftRoute, dashboard, liveShell, migration, publicService, lifecycle, cronRoute] = await Promise.all([
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110002_dressing_room_nfc_checkins.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/shift-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/shift-checkins/route.ts", import.meta.url), "utf8"),
]);

test("browser and legacy check-in writes are retired while manual checkout remains", () => {
  assert.match(checkInRoute, /code: "nfc_required"/);
  assert.match(checkInRoute, /status: 410/);
  assert.match(checkInRoute, /export async function DELETE/);
  assert.match(checkInRoute, /endDancerShift/);
  assert.doesNotMatch(checkInRoute, /process_dancer_location_verification|validateClientLocationReading/);
  assert.doesNotMatch(shiftRoute, /body\.workingStatus|body\.locationStatus|body\.checkedInAt/);
});

test("dancer dashboards instruct physical NFC and never request check-in location", () => {
  const shiftPanel = dashboard.match(/function DancerShiftPanel\(\)[\s\S]*?function canCheckInToShift/)?.[0] || "";
  assert.match(shiftPanel, /Tap NFC at the club/);
  assert.match(shiftPanel, /Tap dressing-room NFC/);
  assert.doesNotMatch(shiftPanel, /navigator\.geolocation|readBrowserLocation|Check in now|Re-verify location/);
  assert.match(liveShell, /Tap dressing-room NFC/);
  assert.match(liveShell, /Check in by tapping the club's official MyDancr dressing-room NFC sticker/);
  assert.doesNotMatch(liveShell, /function requestShiftPosition/);
});

test("NFC check-in is atomic, renewable, and capped at five hours", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /for update/);
  assert.match(migration, /least\(v_shift\.ends_at, v_now \+ interval '5 hours'\)/);
  assert.match(migration, /location_verification_expires_at = v_checkin_expires_at/);
  assert.match(migration, /working_status = 'working_now'/);
  assert.match(migration, /commission_tracking_started_at = coalesce/);
});

test("public Working Now visibility honors NFC expiry", () => {
  const status = publicService.match(/function publicLocationStatus[\s\S]*?\n}/)?.[0] || "";
  assert.match(status, /isCurrentLocationVerification\(shift\)/);
  assert.match(status, /shift\.location_status === "club_confirmed"/);
  assert.doesNotMatch(status, /if \(shift\.location_status === "club_confirmed"\) return/);
});

test("expired shifts still reconcile through requests and authenticated cron", () => {
  assert.match(lifecycle, /reconcileExpiredDancerShifts/);
  assert.match(lifecycle, /checked_out_at: endedAt/);
  assert.match(cronRoute, /process\.env\.CRON_SECRET/);
});
