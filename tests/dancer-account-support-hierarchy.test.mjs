import assert from "node:assert/strict";
import { readFile } from "./helpers/dashboard-test-fs-promises.mjs";
import test from "node:test";

const dashboard = await readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const help = await readFile(new URL("../app/components/DashboardHelp.tsx", import.meta.url), "utf8");

test("dancer account details expose the sign-in editor before optional dashboard tools", () => {
  const dancerAccountSection = dashboard.match(/id="dancer-account"[\s\S]*?id="venue-account"/)?.[0] || "";

  assert.match(dancerAccountSection, /<CustomerAccountPanel account=\{state\.account \|\| \{\}\} accountRole="dancer" onAccountChange=\{updateAccountDetails\} \/>/);
  assert.doesNotMatch(dancerAccountSection, /<Metric label="(?:Status|Email|Role)"/);
  assert.ok(dancerAccountSection.indexOf("<CustomerAccountPanel") < dancerAccountSection.indexOf('!dancerOnboarding ?'));
});

test("notifications read like a compact inbox with quiet bulk actions", () => {
  const notifications = dashboard.match(/function NotificationPanel[\s\S]*?function SupportInboxPanel/)?.[0] || "";

  assert.match(notifications, /className="notification-unread-pill">\{unreadCount\} unread/);
  assert.match(notifications, /className="notification-mark-read-button"[\s\S]*?Mark all read/);
  assert.match(notifications, /className="notification-clear-button"[\s\S]*?Clear all/);
  assert.doesNotMatch(notifications, /<Metric label="Unread"/);
  assert.match(dashboard, /\.notification-clear-button \{[^}]*?justify-self: end;[^}]*?background: transparent;/);
});

test("support and account controls have clear action hierarchy", () => {
  const support = dashboard.match(/function SupportInboxPanel[\s\S]*?function AccountControlsPanel/)?.[0] || "";
  const controls = dashboard.match(/function AccountControlsPanel[\s\S]*?function CustomerPanel/)?.[0] || "";

  assert.match(support, /<DashboardHelpShortcut/);
  assert.doesNotMatch(support, /<form|<textarea/);
  assert.match(help, /Ask the assistant, message the team, and read replies in one place/);
  assert.match(help, /Open Help &amp; support/);
  assert.match(controls, /const accountHeading = ownsVenueWorkspace \? "Venue account & security" : "Account & security"/);
  assert.match(controls, /<h2>\{accountHeading\}<\/h2>/);
  assert.ok(controls.indexOf("Sign out") < controls.indexOf("Disable account"));
  assert.match(controls, /className="account-action-row account-danger-row"[\s\S]*?className="account-action-button danger-button"/);
  assert.match(dashboard, /\.account-action-row \{[^}]*?grid-template-columns: minmax\(0,1fr\) auto;/);
});
