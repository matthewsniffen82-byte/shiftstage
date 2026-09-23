import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { customerFacingDealDescription, customerFacingDealTerms, customerFacingDealTitle } from "../src/lib/dancr/deal-copy.ts";

test("customer Club Deal descriptions suppress the retired demo QR instruction", () => {
  assert.equal(
    customerFacingDealDescription("Open a tracked MyDancr QR to review the complete Club Deal experience."),
    "",
  );
  assert.equal(customerFacingDealDescription("Two-for-one admission before midnight."), "Two-for-one admission before midnight.");
});

test("customer Club Deal terms omit redundant NFC instructions without removing venue rules", () => {
  assert.equal(
    customerFacingDealTerms(
      "One redemption per party. Cashier NFC confirmation is required. Both guests must arrive together.",
    ),
    "One redemption per party. Both guests must arrive together.",
  );
  assert.equal(
    customerFacingDealTerms("Cashier NFC confirmation is required.\nSubject to house rules."),
    "Subject to house rules.",
  );
  assert.equal(customerFacingDealTerms(null), "");
});

test("both offer previews normalize Free Entry while preserving other deal names", () => {
  const liveSource = readFileSync(new URL("../src/live-shell/app/08-save-customer-deal-pass.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(liveSource.slice(liveSource.indexOf("    function customerFacingDealTitle("), liveSource.indexOf("    function customerFacingDealTerms(")), context);
  for (const [value, expected] of [
    ["Free admission", "Free Entry"], [" FREE ADMISSION ", "Free Entry"], ["Free entry", "Free Entry"],
    ["Two-for-one admission", "Two-for-one admission"], ["Free admission before midnight", "Free admission before midnight"],
  ]) {
    assert.equal(customerFacingDealTitle(value), expected);
    assert.equal(context.customerFacingDealTitle(value), expected);
  }
});
