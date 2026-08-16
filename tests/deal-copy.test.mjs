import assert from "node:assert/strict";
import test from "node:test";
import { customerFacingDealTerms } from "../src/lib/dancr/deal-copy.ts";

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
