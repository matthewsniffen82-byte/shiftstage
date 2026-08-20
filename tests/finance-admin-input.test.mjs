import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAdminFinanceBody,
  parseManageEarningInput,
  parseManualPaymentInput,
  parsePayoutSettingsInput,
  parseReconcileBitsafePayoutInput,
  parseRetryPayoutInput,
} from "../src/lib/dancr/finance-admin-input.ts";

test("finance request parsing rejects non-object JSON bodies without changing valid objects", () => {
  const body = { action: "record_manual_payment", invoiceId: "invoice-1" };
  assert.deepEqual(parseAdminFinanceBody(body), { ok: true, value: body });

  for (const input of [null, [], "record_manual_payment", 42, true]) {
    assert.deepEqual(parseAdminFinanceBody(input), {
      ok: false,
      error: "Invalid finance request.",
    });
  }
});

test("manual payment parsing trims identifiers and preserves positive whole-cent validation", () => {
  assert.deepEqual(parseManualPaymentInput({
    invoiceId: "  invoice-1  ",
    reference: "  bank-reference  ",
    totalPaidCents: "1250",
  }), {
    ok: true,
    value: {
      invoiceId: "invoice-1",
      reference: "bank-reference",
      totalPaidCents: 1250,
    },
  });

  for (const totalPaidCents of [0, -1, 1.5, "not-a-number"]) {
    assert.deepEqual(parseManualPaymentInput({
      invoiceId: "invoice-1",
      reference: "reference",
      totalPaidCents,
    }), {
      ok: false,
      error: "Payment total must be a positive whole number of cents.",
    });
  }
  assert.throws(
    () => parseManualPaymentInput({ reference: "reference", totalPaidCents: 100 }),
    /Invoice is required\./,
  );
  assert.throws(
    () => parseManualPaymentInput({ invoiceId: "invoice-1", totalPaidCents: 100 }),
    /Payment reference is required\./,
  );
});

test("payout settings parsing preserves every provider, mode, and numeric boundary", () => {
  for (const paymentProvider of ["stripe", "bitsafe", "adyen", "other"]) {
    for (const payoutMode of ["manual_cashout", "scheduled", "both"]) {
      assert.deepEqual(parsePayoutSettingsInput({
        payoutsEnabled: true,
        paymentProvider,
        payoutMode,
        earningsHoldDays: "0",
        minimumPayoutCents: "10000000",
      }), {
        ok: true,
        value: {
          payoutsEnabled: true,
          paymentProvider,
          payoutMode,
          earningsHoldDays: 0,
          minimumPayoutCents: 10_000_000,
        },
      });
    }
  }

  assert.equal(parsePayoutSettingsInput({
    payoutsEnabled: "true",
    paymentProvider: "bitsafe",
    payoutMode: "scheduled",
    earningsHoldDays: 90,
    minimumPayoutCents: 1,
  }).value.payoutsEnabled, false);
  assert.throws(() => parsePayoutSettingsInput({
    paymentProvider: "unsupported",
    payoutMode: "scheduled",
    earningsHoldDays: 0,
    minimumPayoutCents: 1,
  }), /Unsupported payout provider\./);
  assert.throws(() => parsePayoutSettingsInput({
    paymentProvider: "bitsafe",
    payoutMode: "unsupported",
    earningsHoldDays: 0,
    minimumPayoutCents: 1,
  }), /Unsupported payout mode\./);
  assert.throws(() => parsePayoutSettingsInput({
    paymentProvider: "bitsafe",
    payoutMode: "scheduled",
    earningsHoldDays: 91,
    minimumPayoutCents: 1,
  }), /Hold days must be between 0 and 90\./);
  assert.throws(() => parsePayoutSettingsInput({
    paymentProvider: "bitsafe",
    payoutMode: "scheduled",
    earningsHoldDays: 0,
    minimumPayoutCents: 0,
  }), /Minimum payout is invalid\./);
});

test("earning management parsing preserves actions, trimming, and audit-reason limits", () => {
  for (const earningAction of ["hold", "release", "reverse"]) {
    assert.deepEqual(parseManageEarningInput({
      earningId: "  earning-1  ",
      earningAction,
      reason: "  reviewed  ",
    }), {
      ok: true,
      value: { earningId: "earning-1", earningAction, reason: "reviewed" },
    });
  }
  for (const reason of ["ab", "x".repeat(501)]) {
    assert.deepEqual(parseManageEarningInput({
      earningId: "earning-1",
      earningAction: "hold",
      reason,
    }), { ok: false, error: "Reason must be between 3 and 500 characters." });
  }
  assert.equal(parseManageEarningInput({
    earningId: "earning-1",
    earningAction: "hold",
    reason: "x".repeat(500),
  }).ok, true);
  assert.throws(() => parseManageEarningInput({
    earningId: "earning-1",
    earningAction: "unsupported",
    reason: "reviewed",
  }), /Unsupported earning action\./);
});

test("retry parsing preserves required payout and retry-reason contracts", () => {
  assert.deepEqual(parseRetryPayoutInput({ payoutId: "  payout-1 ", reason: " retry " }), {
    ok: true,
    value: { payoutId: "payout-1", reason: "retry" },
  });
  assert.deepEqual(parseRetryPayoutInput({ payoutId: "payout-1", reason: "no" }), {
    ok: false,
    error: "Reason must be between 3 and 500 characters.",
  });
  assert.throws(() => parseRetryPayoutInput({ reason: "retry" }), /Payout is required\./);
  assert.throws(() => parseRetryPayoutInput({ payoutId: "payout-1" }), /A retry reason is required\./);
});

test("Bitsafe reconciliation parsing preserves reference and reason boundaries", () => {
  const reconciliationReference = "r".repeat(160);
  assert.deepEqual(parseReconcileBitsafePayoutInput({
    payoutId: "  payout-1  ",
    reconciliationReference,
    reason: "  paid report reviewed  ",
  }), {
    ok: true,
    value: {
      payoutId: "payout-1",
      reconciliationReference,
      reason: "paid report reviewed",
    },
  });
  for (const input of [
    { payoutId: "payout-1", reconciliationReference: "r".repeat(161), reason: "reviewed" },
    { payoutId: "payout-1", reconciliationReference: "report", reason: "no" },
    { payoutId: "payout-1", reconciliationReference: "report", reason: "r".repeat(501) },
  ]) {
    assert.deepEqual(parseReconcileBitsafePayoutInput(input), {
      ok: false,
      error: "Reconciliation details are invalid.",
    });
  }
  assert.throws(
    () => parseReconcileBitsafePayoutInput({ payoutId: "payout-1", reason: "reviewed" }),
    /Yoursafe report reference is required\./,
  );
});
