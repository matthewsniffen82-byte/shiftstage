import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, liveShell, profileRoute, broadcasts, shiftRoute, nfcRoute, dancerDashboardRoute, dealActions] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/customer-follow-notifications.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-deal-actions.ts", import.meta.url), "utf8"),
]);

test("guest notification settings use one auto-saving follow-alert switch", () => {
  const panel = dashboard.match(/function CustomerPreferencesPanel[\s\S]*?function readSetting/)?.[0] || "";
  assert.match(panel, /role="switch"/);
  assert.match(panel, /aria-checked=\{followAlertsEnabled\}/);
  assert.match(panel, /saveFollowAlerts\(!followAlertsEnabled\)/);
  assert.match(panel, /notificationSettings: \{ followAlertsEnabled: nextEnabled \}/);
  assert.doesNotMatch(panel, /City|Save preferences|type="checkbox"|CUSTOMER_NOTIFICATION_OPTIONS/);

  for (const label of ["Working Now", "Upcoming shifts", "New Club Deals", "New dancers"]) {
    assert.match(panel, new RegExp(label));
    assert.match(liveShell, new RegExp(label));
  }
  for (const removed of ["Followed dancers only", "Followed clubs only", "Any dancer in city", "Venue schedules", "Club changes", "Cancelled shifts"]) {
    assert.doesNotMatch(panel, new RegExp(removed));
    assert.doesNotMatch(liveShell, new RegExp(removed));
  }
  assert.match(liveShell, /data-notification-key="followAlertsEnabled" role="switch"/);
  assert.match(liveShell, /saveLiveCustomerProfile\(\{ notificationSettings: customerNotificationSettingsPayload\(\) \}\)/);
});

test("the customer profile endpoint accepts only the canonical master setting", () => {
  assert.match(profileRoute, /typeof followAlertsEnabled !== "boolean"/);
  assert.match(profileRoute, /update\.notificationSettings = \{ followAlertsEnabled \}/);
  assert.doesNotMatch(profileRoute, /update\.notificationSettings = body\.notificationSettings/);
});

test("follow alerts are globally gated, active-customer-only, and idempotent", () => {
  assert.match(broadcasts, /followAlertsEnabled !== false/);
  assert.match(broadcasts, /\.eq\("role", "customer"\)[\s\S]*?\.eq\("account_state", "active"\)/);
  assert.match(broadcasts, /\.from\(source\)[\s\S]*?\.eq\(targetColumn, targetId\)/);
  assert.doesNotMatch(broadcasts, /\.eq\("notifications_enabled", true\)/);
  assert.match(broadcasts, /deterministicNotificationId/);
  assert.match(broadcasts, /ignoreDuplicates: true/);
  assert.match(broadcasts, /deliverNotificationRows\(client, insertedRows\)/);
});

test("only the four requested follow events create customer activity alerts", () => {
  assert.match(shiftRoute, /broadcastFollowedDancerUpcomingShift/);
  assert.match(broadcasts, /kind: "followed_dancer_upcoming_shift"/);
  assert.match(nfcRoute, /shiftCheckedIn === true && affiliation\?\.tapApplied === true[\s\S]*?broadcastFollowedDancerWorkingNow/);
  assert.match(broadcasts, /kind: "followed_dancer_working_now"/);
  assert.match(dealActions, /publishingDeal = input\.isActive && existingDeal\?\.isActive !== true/);
  assert.match(dealActions, /broadcastFollowedClubDealPublished/);
  assert.match(broadcasts, /kind: "followed_club_deal_published"/);
  assert.match(nfcRoute, /affiliation\?\.affiliationActivated === true[\s\S]*?broadcastFollowedClubRosterAddition/);
  assert.match(dancerDashboardRoute, /affiliationActivated === true[\s\S]*?broadcastFollowedClubRosterAddition/);
  assert.match(broadcasts, /kind: "followed_club_roster_addition"/);
  assert.doesNotMatch(shiftRoute, /broadcastShiftCancelled|cancelledShifts/);
});
