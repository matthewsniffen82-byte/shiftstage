import assert from "node:assert/strict";
import test from "node:test";
import { customerFacingDealDescription, customerFacingDealTerms } from "../src/lib/dancr/deal-copy.ts";

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
