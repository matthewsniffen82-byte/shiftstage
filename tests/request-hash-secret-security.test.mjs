import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dmca, venueClaims] = await Promise.all([
  readFile(new URL("../src/lib/dancr/dmca.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-claims.ts", import.meta.url), "utf8"),
]);

test("request identifiers never fall back to public hard-coded hashing secrets", () => {
  assert.match(dmca, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(dmca, /DMCA request security is not configured/);
  assert.doesNotMatch(dmca, /"mydancr-dmca-rate-limit"/);

  assert.match(venueClaims, /process\.env\.DANCR_IP_HASH_SECRET/);
  assert.match(venueClaims, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(venueClaims, /Venue claim request security is not configured/);
  assert.doesNotMatch(venueClaims, /"dancr-venue-claim-rate-limit"/);
});
