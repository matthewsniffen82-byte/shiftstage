import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const review = readFileSync(
  new URL("../docs/security-hardening-final-adversarial-review.md", import.meta.url),
  "utf8",
);

const attackEvidence = [
  [1, "auth-session-security.test.mjs"],
  [2, "authorization-idor-protection.test.mjs"],
  [3, "authorization-idor-protection.test.mjs"],
  [4, "authorization-idor-protection.test.mjs"],
  [5, "account-role-database-security.test.mjs"],
  [6, "non-admin-write-request-security.test.mjs"],
  [7, "authorization-idor-protection.test.mjs"],
  [8, "deal-financial-race-security.test.mjs"],
  [9, "deal-financial-race-security.test.mjs"],
  [10, "nfc-request-security.test.mjs"],
  [11, "deal-redemption-attribution-boundary.test.mjs"],
  [12, "video-upload-security.test.mjs"],
  [13, "bounded-form-data.test.mjs"],
  [14, "social-profile-url-security.test.mjs"],
  [15, "rate-limit-abuse-defense.test.mjs"],
  [16, "supabase-rls-hardening.test.mjs"],
  [17, "server-managed-media-storage-security.test.mjs"],
  [18, "application-resource-bounds.test.mjs"],
  [19, "public-data-exposure-security.test.mjs"],
  [20, "service-role-route-inventory.test.mjs"],
];

test("all twenty required adversarial scenarios retain executable regression evidence", () => {
  assert.deepEqual(
    attackEvidence.map(([id]) => id),
    Array.from({ length: 20 }, (_, index) => index + 1),
  );

  for (const [id, filename] of attackEvidence) {
    const fileUrl = new URL(`./${filename}`, import.meta.url);
    assert.equal(existsSync(fileUrl), true, `Scenario ${id} is missing ${filename}`);
    assert.match(readFileSync(fileUrl, "utf8"), /test\("/, `${filename} must remain executable`);
    assert.match(review, new RegExp(`\\| ${id} \\|`), `Scenario ${id} is missing from the final review`);
  }
});

test("the final review distinguishes live probes from production-safe regression evidence", () => {
  assert.match(review, /did not create production accounts/i);
  assert.match(review, /No hostile or oversized file was uploaded to production/i);
  assert.match(review, /No simultaneous financial requests or high-rate traffic were sent to production/i);
  assert.match(review, /not claims that the corresponding attacks were executed live/i);
});

test("the discovered least-privilege gap is isolated for a separate remediation step", () => {
  assert.match(review, /One low-severity least-privilege finding remains/i);
  assert.match(review, /57 legacy INSERT, UPDATE, or DELETE grants across 19 tables/i);
  assert.match(review, /must be removed in a separate, isolated follow-up security step/i);
  assert.doesNotMatch(review, /no findings/i);
});
