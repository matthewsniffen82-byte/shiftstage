import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { CLUB_TRANSPORTATION_TERMS, clubDealTransportationTerms, isEligibleClubTransportation } from "../src/lib/dancr/club-deal-transportation.ts";
import { customerFacingDealTerms } from "../src/lib/dancr/deal-copy.ts";
import { defaultClubDealOfferPreset } from "../src/lib/dancr/club-deal-presets.ts";

const key = "mydancrPendingNfcDealV2";
const ttl = 12 * 60 * 60 * 1000;
const now = Date.now();
const intent = { venueId: "venue", dealId: "deal", sourceType: "dancer_profile", dancerId: "dancer", attributionToken: "signed-token", savedAt: now, expiresAt: now + ttl };
const shellPath = "../src/live-shell/app/08-save-customer-deal-pass.js";

function functionSource(path, name) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `${name} exists in ${path}`);
  return ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

function readers(value) {
  const localStorage = { getItem: name => name === key ? JSON.stringify(value) : null };
  const globals = { window: { localStorage }, localStorage, isEligibleClubTransportation, DEAL_INTENT_KEY: key, DEAL_INTENT_TTL_MS: ttl, pendingNfcDealIntentTtlMs: ttl };
  const load = (path, name) => vm.runInNewContext(`${functionSource(path, name)}; ${name}`, globals);
  return {
    cashier: load("../app/nfc/[token]/NfcTapClient.tsx", "readPendingDealIntent"),
    card: load("../app/components/ClubDealCard.tsx", "readPendingDealSelection"),
    savedPass: load(shellPath, "pendingNfcDealIntentForPass"),
  };
}

test("every eligible arrival survives cashier, offer-card and saved-pass readers", () => {
  for (const transportation of ["self_drive", "club_shuttle", "autonomous_cab", "waymo", "zoox", "cybercab"]) {
    const r = readers({ ...intent, transportation });
    assert.equal(r.cashier("registered-tag").transportation, transportation);
    assert.equal(r.cashier("registered-tag").attributionToken, "signed-token");
    assert.equal(r.card(intent).expired, false);
    assert.equal(r.savedPass(intent).expired, false);
    assert.equal(r.savedPass(intent).transportation, transportation);
  }
});

test("unrecognized and excluded transportation never becomes a ready deal", () => {
  for (const transportation of ["rideshare_taxi", "uber", "lyft", "taxi", "unknown", "Waymo", null, {}, undefined]) {
    const r = readers({ ...intent, transportation });
    assert.equal(isEligibleClubTransportation(transportation), false);
    assert.equal(r.cashier("registered-tag"), null);
    assert.equal(r.card(intent), null);
    assert.equal(r.savedPass(intent), null);
  }
});

test("autonomous arrival preserves expiry, offer matching and dancer attribution boundaries", () => {
  for (const transportation of ["autonomous_cab", "waymo", "zoox", "cybercab"]) {
    const expired = readers({ ...intent, transportation, savedAt: now - ttl - 1000, expiresAt: now - 1000 });
    assert.equal(expired.cashier("registered-tag"), null);
    assert.equal(expired.card(intent).expired, true);
    assert.equal(expired.savedPass(intent).expired, true);
    const current = readers({ ...intent, transportation });
    assert.equal(current.cashier(""), null);
    for (const mismatch of [{ venueId: "other" }, { dealId: "other" }, { sourceType: "club_page" }, { dancerId: "other" }]) {
      assert.equal(current.card({ ...intent, ...mismatch }), null);
      assert.equal(current.savedPass({ ...intent, ...mismatch }), null);
    }
  }
});

test("existing standard terms and future presets include autonomous arrivals without losing house rules", () => {
  const shellTerms = vm.runInNewContext(`${functionSource(shellPath, "phoneTapCopy")}\n${functionSource(shellPath, "customerFacingDealTerms")}; customerFacingDealTerms`);
  const rules = "Before midnight. Valid ID required. Subject to capacity, age requirements, dress code, and house rules.";
  for (const policy of [
    "Free admission requires arrival in your own car or other private car that is not an Uber or taxi, or use of the club's free shuttle service.",
    "Free admission when you arrive in a private car or club-provided transport. Arrivals by Uber, Lyft, other rideshares, or taxi do not qualify.",
    CLUB_TRANSPORTATION_TERMS,
  ]) {
    const terms = `${policy} ${rules}`;
    const expected = `${CLUB_TRANSPORTATION_TERMS} ${rules}`;
    assert.equal(customerFacingDealTerms(terms), expected);
    assert.equal(shellTerms(terms), expected);
    assert.equal(clubDealTransportationTerms(terms), expected);
    assert.equal(clubDealTransportationTerms(expected), expected);
  }
  assert.equal(customerFacingDealTerms(rules), rules);
  assert.equal(shellTerms(rules), rules);
  assert.equal(defaultClubDealOfferPreset().terms.startsWith(CLUB_TRANSPORTATION_TERMS), true);
});
