import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, redemptionRoute, redemptionActions, latestFinanceMigration, deals, nfc] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608300002_serialize_financial_redemptions.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redeem/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608220003_agent_commission_nats_settlement.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
]);

test("identical cashier NFC redemptions serialize by deal and stable identity", () => {
  const lockPosition = migration.indexOf("perform pg_advisory_xact_lock");
  const insertPosition = migration.indexOf("insert into public.qr_redemptions");
  const confirmPosition = migration.indexOf("public.confirm_deal_redemption_from_nfc(");
  assert.ok(lockPosition > 0);
  assert.ok(insertPosition > lockPosition);
  assert.ok(confirmPosition > insertPosition);
  assert.match(migration, /hashtext\(p_club_deal_id::text\)/);
  assert.match(migration, /hashtext\(coalesce\(p_customer_id::text, p_session_id::text\)\)/);
  assert.match(migration, /p_session_id::text/);
});

test("financial allocation remains database-derived and atomically persisted", () => {
  assert.match(latestFinanceMigration, /where redemption\.redemption_token = p_token[\s\S]*?for update/);
  assert.match(latestFinanceMigration, /where id = p_tag_id for update/);
  assert.match(latestFinanceMigration, /v_gross_cents := v_referral_term\.fee_cents/);
  assert.match(latestFinanceMigration, /v_platform_cents := v_gross_cents - v_dancer_cents - v_agent_cents/);
  assert.match(latestFinanceMigration, /insert into public\.deal_revenue_events[\s\S]*?insert into public\.agent_commission_events[\s\S]*?insert into public\.commission_events/);
});

test("legacy non-NFC financial confirmation is retired at route and database boundaries", () => {
  assert.match(redemptionRoute, /export async function POST\(\)/);
  assert.match(redemptionRoute, /status: 410/);
  assert.match(redemptionRoute, /replacement: "cashier_nfc"/);
  assert.doesNotMatch(redemptionRoute, /createRequestSupabaseContext|redeemDealToken|QR_REDEMPTION_VENUE_CONFIRMED/);
  assert.doesNotMatch(redemptionActions, /export async function (?:createDealRedemption|redeemDealToken)|rpc\("confirm_deal_redemption"/);
  assert.doesNotMatch(nfc, /export async function confirmRedemptionFromNfc/);
  assert.match(deals, /if \(!\/\^\[A-Za-z0-9_-\]\{40,120\}\$\/\.test\(token\)\) return null;/);
  assert.match(
    migration,
    /revoke all on function public\.confirm_deal_redemption\(text, jsonb\)[\s\S]*?from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.issue_and_confirm_deal_redemption_from_nfc\([\s\S]*?from public, anon, authenticated;[\s\S]*?grant execute[\s\S]*?to service_role/,
  );
});
