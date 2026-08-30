import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608300006_minimize_authenticated_dml_grants.sql", import.meta.url),
  "utf8",
);
const notificationRoute = readFileSync(
  new URL("../app/api/notifications/route.ts", import.meta.url),
  "utf8",
);
const eventRoute = readFileSync(new URL("../app/api/events/route.ts", import.meta.url), "utf8");
const venueEventRoute = readFileSync(
  new URL("../app/api/public/venue-events/route.ts", import.meta.url),
  "utf8",
);
const dancerFinanceRoute = readFileSync(
  new URL("../app/api/dancer/finance/route.ts", import.meta.url),
  "utf8",
);

const serviceManagedTables = [
  "commission_events",
  "dancer_earning_status_history",
  "dancer_payout_accounts",
  "dancer_payout_batches",
  "dancer_payout_items",
  "financial_audit_events",
  "mydancr_tv_events",
  "nats_affiliate_accounts",
  "nats_agent_affiliate_accounts",
  "nats_agent_commission_exports",
  "nats_commission_exports",
  "payment_provider_webhook_events",
  "payout_settings",
  "support_ai_runs",
  "venue_page_events",
];
const readOnlyBrowserTables = [
  "direction_requests",
  "profile_views",
  "schedule_views",
  "social_clicks",
  "support_messages",
];

test("unused browser DML grants are removed without revoking legitimate reads", () => {
  assert.match(migration, /revoke insert, update, delete on table/i);
  for (const table of serviceManagedTables) {
    assert.match(migration, new RegExp(`public\\.${table}[,\\s]`, "i"), table);
  }

  assert.match(migration, /revoke update, delete on table/i);
  for (const table of readOnlyBrowserTables) {
    assert.match(migration, new RegExp(`public\\.${table}[,\\s]`, "i"), table);
  }

  assert.match(migration, /revoke delete on table public\.support_threads from anon, authenticated/i);
  assert.doesNotMatch(migration, /revoke select/i);
  assert.equal(serviceManagedTables.length * 3 + readOnlyBrowserTables.length * 2 + 1, 56);
});

test("notification clearing keeps one explicit authenticated owner policy", () => {
  assert.match(notificationRoute, /clearUserNotifications\(client, user\.id\)/);
  assert.match(migration, /revoke delete on table public\.notifications from anon/i);
  assert.doesNotMatch(migration, /revoke delete on table public\.notifications from anon, authenticated/i);
  assert.match(
    migration,
    /create policy "users delete own notifications"[\s\S]*?for delete[\s\S]*?to authenticated[\s\S]*?using \(recipient_id = auth\.uid\(\)\)/i,
  );
});

test("analytics and financial writers remain behind trusted server clients", () => {
  assert.match(eventRoute, /const client = createAdminSupabaseClient\(\)/);
  assert.match(venueEventRoute, /const client = createAdminSupabaseClient\(\)/);
  assert.match(dancerFinanceRoute, /requestNatsAffiliateLink\(createAdminSupabaseClient\(\), user\.id/);
  assert.match(dancerFinanceRoute, /requestDancerCashOut\(createAdminSupabaseClient\(\), user\.id/);
});
