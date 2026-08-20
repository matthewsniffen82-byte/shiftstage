import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [actions, store, finance, route] = await Promise.all([
  readFile(new URL("../src/lib/dancr/dancer-payout-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/payout-account-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/finance/route.ts", import.meta.url), "utf8"),
]);

test("dancer payout enrollment and cash-out writes use one dedicated action boundary", () => {
  assert.match(route, /from "@\/src\/lib\/dancr\/dancer-payout-actions"/);
  assert.match(route, /from "@\/src\/lib\/dancr\/finance"/);
  for (const action of [
    "createDancerConnectOnboarding",
    "refreshDancerConnectAccount",
    "requestDancerCashOut",
  ]) {
    assert.match(actions, new RegExp(`export async function ${action}`));
    assert.doesNotMatch(finance, new RegExp(`export async function ${action}`));
  }
});

test("payout account state and effective settings have one shared persistence boundary", () => {
  for (const operation of [
    "getDancerForUser",
    "getDancerPayoutAccount",
    "upsertDancerPayoutAccount",
    "getEffectivePayoutSettings",
  ]) {
    assert.match(store, new RegExp(`export async function ${operation}`));
    assert.doesNotMatch(finance, new RegExp(`(?:async function|export async function) ${operation}`));
  }
  assert.match(finance, /from "\.\/payout-account-store"/);
  assert.match(actions, /from "\.\/payout-account-store"/);
});

test("dancer cash-out retains payout guards, balance validation, and the production procedure", () => {
  assert.match(actions, /if \(!settings\.payoutsEnabled\)/);
  assert.match(actions, /settings\.payoutMode !== "manual_cashout" && settings\.payoutMode !== "both"/);
  assert.match(actions, /preview\.balances\.availableCents/);
  assert.match(actions, /settings\.minimumPayoutCents/);
  assert.match(actions, /rpc\("request_dancer_payout"/);
  assert.match(actions, /p_request_key: requestKey/);
  assert.match(actions, /p_is_test: false/);
});

test("dancer onboarding retains provider gating and Bitsafe callback handling", () => {
  assert.match(actions, /settings\.paymentProvider === "bitsafe"/);
  assert.match(actions, /new URL\("\/api\/bitsafe\/callback", returnUrl\)/);
  assert.match(actions, /provider\.createConnectedAccount/);
  assert.match(actions, /provider\.createOnboardingLink/);
  assert.match(actions, /retrieveConnectedAccount\(providerAccountId\)/);
});
