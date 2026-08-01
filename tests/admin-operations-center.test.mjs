import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, route, operations, liveApp] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/operations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin-operations.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("operations endpoint requires a real authenticated admin", () => {
  assert.match(route, /createRequestSupabaseContext\(request\)/);
  assert.match(route, /await requireAdmin\(client, user\.id\)/);
  assert.match(route, /getAdminOperationsCenter\(createAdminSupabaseClient\(\)\)/);
});

test("operations center is backed by production queues and audit records", () => {
  for (const table of [
    "dancer_profiles",
    "image_moderation_records",
    "mydancr_tv_videos",
    "approval_reviews",
    "content_reports",
    "dmca_cases",
    "support_threads",
    "shifts",
    "qr_redemptions",
    "deal_revenue_events",
    "admin_actions",
    "app_users",
  ]) {
    assert.match(operations, new RegExp(`from\\(\\"${table}\\"\\)`));
  }
  assert.match(operations, /pendingVenuePaymentCents/);
  assert.match(operations, /conversionRate/);
  assert.match(operations, /warnings/);
  assert.doesNotMatch(operations, /mock|sample data|placeholder/i);
});

test("admin UI provides the complete mobile operations workspace", () => {
  for (const workspace of ["overview", "approvals", "activity", "accounts", "system"]) {
    assert.match(client, new RegExp(`\\"${workspace}\\"`));
  }
  assert.match(client, /What needs attention now/);
  assert.match(client, /Live operations/);
  assert.match(client, /Revenue & deal health/);
  assert.match(client, /Growth & engagement/);
  assert.match(client, /Recent admin activity/);
  assert.match(client, /Dancers, customers, venues & admins/);
  assert.match(client, /Platform health/);
  assert.match(client, /admin-workspace-nav/);
  assert.match(client, /@media \(max-width: 680px\)/);
});

test("real in-app admin dashboard exposes live operations and full command center", () => {
  assert.match(liveApp, /getAuthenticatedJson\("\/api\/admin\/operations"\)/);
  assert.match(liveApp, /id="adminOperationsSummary"/);
  assert.match(liveApp, /function renderAdminOperationsSummary\(\)/);
  assert.match(liveApp, />Open full operations center<\/a>/);
});
