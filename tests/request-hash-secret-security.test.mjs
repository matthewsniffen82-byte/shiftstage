import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

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
  assert.doesNotMatch(venueClaims, /"dancr-venue-claim-rate-limit"/);
});

for (const [label, source, name, variable] of [
  ["DMCA", dmca, "hashRequestIp", "DMCA_RATE_LIMIT_SALT"],
  ["club claim", venueClaims, "hashVenueClaimRequestIp", "DANCR_IP_HASH_SECRET"],
]) test(`${label} request hashing fails closed without a private secret and uses the configured secret`, () => {
  const exports = {}, env = {};
  const code = ts.transpileModule(source + `\nexports.hash = ${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, process: { env }, Error, require: name => name === "node:crypto" ? { createHash, createHmac } : {} });
  const expected = secret => label === "DMCA" ? createHash("sha256").update(`${secret}:192.0.2.1`).digest("hex")
    : createHmac("sha256", secret).update("192.0.2.1").digest("hex");
  assert.throws(() => exports.hash("192.0.2.1"));
  env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-secret";
  assert.equal(exports.hash("192.0.2.1"), expected(env.SUPABASE_SERVICE_ROLE_KEY));
  env[variable] = "synthetic-dedicated-secret";
  assert.equal(exports.hash("192.0.2.1"), expected(env[variable]));
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env[variable];
  assert.throws(() => exports.hash("192.0.2.1"));
});
