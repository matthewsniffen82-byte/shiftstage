import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { payoutCopy } from "../src/lib/dancr/payout-copy.ts";
import { phoneTapCopy } from "../src/lib/dancr/phone-tap-copy.ts";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";

test("older payout messages keep amounts and retry instructions while explaining the provider", () => {
  for (const [input, expected] of [
    ["Your verified NATS account is already linked.", "Your verified payout account is already linked."],
    ["NATS affiliate login ID is invalid.", "Payout account login ID is invalid."],
    ["NATS accepted the invoice for $42.50. Verify it in NATS before retrying.", "The payout provider accepted the invoice for $42.50. Verify it in the payout portal before retrying."],
    ["NATS commission exports require USD.", "Commission exports require USD."],
    ["https://nats.example.com/login /nats/account nats:record:42 NATS_API_KEY", "https://nats.example.com/login /nats/account nats:record:42 NATS_API_KEY"],
    ["https://example.com/?provider=nats /account?provider=nats", "https://example.com/?provider=nats /account?provider=nats"],
    ["Earlier redemptions do not earn commissions or back pay.", "Earlier redemptions do not earn commissions or back pay."],
  ]) assert.equal(payoutCopy(input), expected);
});

test("admin event labels describe payout accounts while retaining phone tap labels", async () => {
  const admin = await readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8");
  const source = admin.match(/function labelize\(value: string\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const labelize = vm.runInNewContext(`${source.replace("value: string", "value")}labelize`, { payoutCopy, phoneTapCopy });
  assert.equal(labelize("verify_nats_affiliate"), "Verify payout account");
  assert.equal(labelize("nats_active"), "Payout account active");
  assert.equal(labelize("nfc_sticker"), "Tap sticker");
});

test("payout error wording preserves API status, error codes and internal diagnostics", () => {
  const original = "Your verified NATS account is already linked.";
  const result = resolveApiError(new PublicApiError("CONFLICT", original, 409), "Unable to connect your payout account.");
  assert.deepEqual(result.body, { ok: false, error: "Your verified payout account is already linked.", code: "CONFLICT" });
  assert.equal(result.status, 409);
  assert.equal(result.internalMessage, original);
  assert.equal(result.shouldLog, false);
});
