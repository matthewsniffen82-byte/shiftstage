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

test("customer alert preferences use independent auto-saving switches under Alerts", () => {
  const panel = dashboard.match(/function CustomerPreferencesPanel[\s\S]*?type DancerIdentityDraft/)?.[0] || "";
  assert.match(panel, /role="switch"/);
  assert.match(panel, /aria-checked=\{checked\}/);
  assert.match(panel, /savePreference\(alert.key, !settings\[alert.key\]\)/);
  assert.match(panel, /notificationSettings: \{ \[key\]: nextEnabled \}/);
  assert.doesNotMatch(panel, /City|Save preferences|type="checkbox"|CUSTOMER_NOTIFICATION_OPTIONS/);
  assert.match(panel, /Email notifications/);
  assert.match(panel, /Push notifications/);
  const alerts = dashboard.slice(dashboard.indexOf('id="customer-alerts"'), dashboard.indexOf('id="customer-account"'));
  assert.match(alerts, /<CustomerPreferencesPanel/);
  for (const removed of ["Followed dancers only", "Followed clubs only", "Any dancer in city", "Venue schedules", "Club changes", "Cancelled shifts"]) {
    assert.doesNotMatch(panel, new RegExp(removed));
    assert.doesNotMatch(liveShell, new RegExp(removed));
  }
  assert.match(liveShell, /href="\/dashboard\/customer#customer-alerts">Manage notification preferences/);
  assert.doesNotMatch(liveShell, /One switch controls/);
});

test("the customer profile endpoint validates a partial preference patch and channel availability", () => {
  assert.match(profileRoute, /parseCustomerNotificationPatch\(body.notificationSettings\)/);
  assert.match(profileRoute, /!delivery.emailAvailable/);
  assert.match(profileRoute, /!delivery.pushAvailable/);
  assert.doesNotMatch(profileRoute, /update\.notificationSettings = body\.notificationSettings/);
});

test("follow alerts are globally gated, active-customer-only, and idempotent", () => {
  assert.match(broadcasts, /customerFollowAlertEnabled\(settingsById.get\(customerId\), alertKey\)/);
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
