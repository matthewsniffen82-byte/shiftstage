import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/202609080001_prospective_nats_dancer_commissions.sql", import.meta.url), "utf8");
const fixture = await readFile(new URL("./fixtures/nats-prospective-commissions.sql", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const functionBody = (name) => {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return migration.slice(start, migration.indexOf("\n$$;", start) + 4);
};
const confirmer = functionBody("confirm_deal_redemption_from_nfc");

test("NFC redemptions retain attribution without creating a pre-enrollment dancer earning", () => {
  assert.match(confirmer, /account\.dancer_id = v_redemption\.dancer_id\s+and account\.status = 'active' and account\.activated_at <= v_now/);
  assert.match(confirmer, /if v_nats_activated_at is not null then[\s\S]*v_share_bps := case/);
  assert.match(confirmer, /if v_nats_activated_at is not null and v_dancer_cents > 0 then\s+insert into public\.commission_events/);
  assert.match(confirmer, /v_redemption\.dancer_id, v_redemption\.source_type, v_referral_term\.currency/);
  assert.match(migration, /not dancer_commission_eligible and dancer_nats_activated_at is null\s+and dancer_share_bps = 0 and dancer_commission_cents = 0/);
  assert.match(confirmer, /'dancerCommissionEligible', v_nats_activated_at is not null/);
});

test("eligibility is snapshotted at redemption and only eligible events advance existing tiers", () => {
  assert.match(confirmer, /dancer_commission_eligible, dancer_nats_activated_at/);
  assert.match(confirmer, /v_now, v_nats_activated_at is not null, v_nats_activated_at/);
  assert.match(confirmer, /revenue\.commission_month = v_month\s+and revenue\.dancer_commission_eligible/);
  assert.match(confirmer, /when v_success_number >= 25 then 5000\s+when v_success_number >= 10 then 4000\s+else 3000/);
  assert.match(functionBody("preserve_dancer_commission_eligibility"), /new\.dancer_commission_eligible, new\.dancer_nats_activated_at, new\.confirmed_at[\s\S]*is distinct from[\s\S]*Redemption commission eligibility is immutable/);
});

test("enrollment uses database time and the same serialization lock as redemption", () => {
  const activation = functionBody("activate_waiting_nats_exports");
  for (const body of [confirmer, activation]) {
    assert.match(body, /pg_advisory_xact_lock\(hashtext\([^\n]+dancer_id::text\), hashtext\('nats-dancer-enrollment'\)\)/);
  }
  assert.match(activation, /new\.activated_at := clock_timestamp\(\)/);
  assert.match(activation, /new\.activated_at := old\.activated_at/);
  assert.match(activation, /earning\.qr_redemption_id is null/);
  assert.match(migration, /before insert or update on public\.nats_affiliate_accounts/);
});

test("delayed settlement and re-enrollment cannot create back pay or erase eligible earnings", () => {
  const eligibility = functionBody("is_nats_eligible_club_deal_earning");
  assert.match(eligibility, /revenue\.dancer_commission_eligible/);
  assert.match(eligibility, /revenue\.dancer_nats_activated_at <= revenue\.confirmed_at/);
  assert.doesNotMatch(eligibility, /nats_affiliate_accounts|account\.activated_at/);
  const enqueue = functionBody("enqueue_nats_commission_export");
  assert.match(enqueue, /not public\.is_nats_eligible_club_deal_earning\(new\.id\)/);
  assert.match(enqueue, /new\.qr_redemption_id is not null or v_account_active\s+then 'pending'/);
  const claim = functionBody("claim_nats_commission_exports");
  assert.match(claim, /account\.status = 'active'/);
  assert.match(claim, /public\.is_nats_eligible_club_deal_earning\(earning\.id\)/);
  assert.match(claim, /for update of export skip locked/);
  assert.match(claim, /set status = 'reconciliation_required'/);
  assert.match(functionBody("require_enrolled_club_deal_earning"), /Club Deal commission requires NATS eligibility at redemption/);
});

test("existing pre-enrollment money is corrected with history, never deletion or a silent clawback", () => {
  assert.match(migration, /earning\.status in \('paid', 'payout_processing'\)[\s\S]*export\.attempt_count > 0[\s\S]*Reconcile them before applying/);
  assert.match(migration, /earning\.status in \('pending', 'available', 'failed'\)/);
  assert.match(migration, /set status = 'reversed'/);
  assert.match(migration, /set status = 'canceled'/);
  assert.match(migration, /insert into public\.financial_audit_events/);
  assert.match(migration, /platform_commission_cents = platform_commission_cents \+ dancer_commission_cents/);
  assert.doesNotMatch(migration, /delete from|truncate|disable trigger/i);
  assert.match(migration, /set local lock_timeout = '5s'/);
  assert.match(migration, /revoke all on function public\.is_nats_eligible_club_deal_earning\(uuid\) from public, anon, authenticated/);
});

test("sales-agent allocations and public deal visibility stay independent of dancer enrollment", async () => {
  assert.equal((confirmer.match(/agent_allocations_for_venue\(v_redemption\.venue_id, v_gross_cents, v_now\)/g) || []).length, 2);
  assert.match(confirmer, /v_platform_cents := v_gross_cents - v_dancer_cents - v_agent_cents/);
  for (const path of [
    "../src/lib/dancr/deal-redemption-attribution.ts",
    "../src/lib/dancr/cashier-deal-redemption.ts",
    "../app/dancers/[slug]/page.tsx",
    "../app/api/public/discovery/route.ts",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /nats_affiliate_accounts|natsActive|natsAccountStatus/, path);
  }
});

test("dancer setup explains prospective earnings and makes no pre-enrollment accrual promise", () => {
  for (const source of [dashboard, liveApp]) {
    assert.match(source, /Club Deals stay on your profile/);
    assert.match(source, /Commissions start only after your payout account is verified/);
    assert.match(source, /Earlier redemptions do not earn commissions or back pay/);
    assert.doesNotMatch(source, /Commissions keep accruing while MyDancr verifies|Commissions accrue automatically|Your verified commissions will continue to accrue/);
  }
});

test("rollback integration coverage exercises real redemptions, all tiers, disable, and re-enrollment", () => {
  for (const assertion of [
    "Unenrolled redemption allocation failed", "Requested account earned commission",
    "Activation was backdated", "Enrollment created back pay", "Eligible redemption tier % failed",
    "Disabled account earned new commission", "Reactivation credited a disabled-period tap",
    "Previously earned commission could not be claimed after reactivation",
    "Export was claimed twice", "Expected back-pay insert rejection",
    "Browser role can access financial RPC",
  ]) assert.ok(fixture.includes(assertion), assertion);
  assert.match(fixture, /public\.issue_and_confirm_deal_redemption_from_nfc/);
  assert.doesNotMatch(fixture, /complete_nats_commission_export|createNatsManualInvoice/);
});
