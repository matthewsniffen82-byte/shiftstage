import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { phoneTapCopy } from "../src/lib/dancr/phone-tap-copy.ts";
import { customerFacingDealDescription, customerFacingDealTerms } from "../src/lib/dancr/deal-copy.ts";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";

const shell = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const start = shell.indexOf("    function phoneTapCopy(value)");
const end = shell.indexOf("    function customerFacingDealTerms(value)", start);
assert.ok(start >= 0 && end > start);
const livePhoneTapCopy = vm.runInNewContext(`${shell.slice(start, end)}phoneTapCopy`);

test("old tap wording uses the same plain language on both site experiences", () => {
  for (const [input, expected] of [
    ["Open the NFC link if prompted.", "Open the link that appears if prompted."],
    ["NFC stickers are ready. NFC tags are active.", "Tap stickers are ready. Tap stickers are active."],
    ["Use a cashier NFC tap. NFC taps confirm admission.", "Use a cashier phone tap. Phone taps confirm admission."],
    ["This dressing-room NFC tag is inactive.", "This dressing-room tap sticker is inactive."],
    ["Cashier nfc sticker", "Cashier tap sticker"],
    ["NFC confirmation is required.", "Phone tap confirmation is required."],
    ["https://mydancr.com/nfc/abc /nfc/abc nfc:venue:deal NFC_TAG_TYPES", "https://mydancr.com/nfc/abc /nfc/abc nfc:venue:deal NFC_TAG_TYPES"],
    ["https://mydancr.com/dashboard/dancer?nfc=complete /dashboard/dancer?nfc=complete", "https://mydancr.com/dashboard/dancer?nfc=complete /dashboard/dancer?nfc=complete"],
    ["Bring ID. One use per guest. Valid until 11 PM.", "Bring ID. One use per guest. Valid until 11 PM."],
  ]) {
    assert.equal(phoneTapCopy(input), expected);
    assert.equal(livePhoneTapCopy(input), expected);
  }
});

test("existing stored offers retain their restrictions while using phone-tap wording", () => {
  assert.equal(customerFacingDealDescription("Use the cashier NFC sticker for half-off admission."), "Use the cashier tap sticker for half-off admission.");
  assert.equal(customerFacingDealTerms("NFC tap required. One use before 11 PM. Cashier NFC confirmation is required."), "Phone tap required. One use before 11 PM.");
});

test("admin activity presents old event identifiers as plain-language labels", async () => {
  const admin = await readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8");
  const labelSource = admin.match(/function labelize\(value: string\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(labelSource);
  const labelize = vm.runInNewContext(`${labelSource.replace("value: string", "value")}labelize`, { phoneTapCopy });
  assert.equal(labelize("provision_admin_nfc_tag"), "Provision admin tap sticker");
  assert.equal(labelize("nfc_sticker"), "Tap sticker");
  assert.equal(labelize("account_approved"), "Account approved");
});

test("public error copy changes without altering error codes, status, or internal diagnostics", () => {
  const result = resolveApiError(new PublicApiError("FORBIDDEN", "This cashier NFC tag is inactive.", 403), "Unable to complete this tap.");
  assert.deepEqual(result.body, { ok: false, error: "This cashier tap sticker is inactive.", code: "FORBIDDEN" });
  assert.equal(result.status, 403);
  assert.equal(result.internalMessage, "This cashier NFC tag is inactive.");
  assert.equal(result.shouldLog, false);
});
