import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAdminFinanceAction,
  parseAdminFinanceBody,
  parseAdminFinanceCommand,
  parseManageEarningInput,
  parseManualPaymentInput,
  parsePayoutSettingsInput,
  parseReconcileBitsafePayoutInput,
  parseRetryPayoutInput,
} from "../src/lib/dancr/finance-admin-input.ts";

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const EARNING_ID = "22222222-2222-4222-8222-222222222222";
const PAYOUT_ID = "33333333-3333-4333-8333-333333333333";

test("finance command parsing validates and sanitizes the complete action payload", () => {
  assert.deepEqual(parseAdminFinanceCommand({ action: "run_automation", ignored: "value" }), {
    ok: true,
    value: { action: "run_automation" },
  });
  assert.deepEqual(parseAdminFinanceCommand({ action: "process_payouts" }), {
    ok: true,
    value: { action: "process_payouts" },
  });
  assert.deepEqual(parseAdminFinanceCommand({
    action: "record_manual_payment",
    invoiceId: ` ${INVOICE_ID} `,
    reference: " bank-reference ",
    totalPaidCents: "1250",
    ignored: "value",
  }), {
    ok: true,
    value: {
      action: "record_manual_payment",
      invoiceId: INVOICE_ID,
      reference: "bank-reference",
      totalPaidCents: 1250,
    },
  });
  assert.deepEqual(parseAdminFinanceCommand({
    action: "retry_payout",
    payoutId: ` ${PAYOUT_ID} `,
    reason: " retry ",
  }), {
    ok: true,
    value: { action: "retry_payout", payoutId: PAYOUT_ID, reason: "retry" },
  });

  assert.deepEqual(parseAdminFinanceCommand(null), {
    ok: false,
    error: "Invalid finance request.",
  });
  assert.deepEqual(parseAdminFinanceCommand({ action: "unsupported" }), {
    ok: false,
    error: "Unsupported finance action.",
  });
  assert.deepEqual(parseAdminFinanceCommand({
    action: "record_manual_payment",
    invoiceId: INVOICE_ID,
    reference: "bank-reference",
    totalPaidCents: 0,
  }), {
    ok: false,
    error: "Payment total must be a positive whole number of cents.",
  });
});

test("finance action parsing accepts only the seven supported production actions", () => {
  for (const action of [
    "run_automation",
    "process_payouts",
    "record_manual_payment",
    "update_payout_settings",
    "manage_earning",
    "retry_payout",
    "reconcile_bitsafe_payout",
  ]) {
    assert.deepEqual(parseAdminFinanceAction({ action }), { ok: true, value: action });
  }

  for (const action of [undefined, null, 1, "unsupported"]) {
    assert.deepEqual(parseAdminFinanceAction({ action }), {
      ok: false,
      error: "Unsupported finance action.",
    });
  }
});

test("finance request parsing rejects non-object JSON bodies without changing valid objects", () => {
  const body = { action: "record_manual_payment", invoiceId: INVOICE_ID };
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
    invoiceId: `  ${INVOICE_ID}  `,
    reference: "  bank-reference  ",
    totalPaidCents: "1250",
  }), {
    ok: true,
    value: {
      invoiceId: INVOICE_ID,
      reference: "bank-reference",
      totalPaidCents: 1250,
    },
  });

  for (const totalPaidCents of [0, -1, 1.5, "not-a-number"]) {
    assert.deepEqual(parseManualPaymentInput({
      invoiceId: INVOICE_ID,
      reference: "reference",
      totalPaidCents,
    }), {
      ok: false,
      error: "Payment total must be a positive whole number of cents.",
    });
  }
  assert.deepEqual(parseManualPaymentInput({ reference: "reference", totalPaidCents: 100 }), {
    ok: false,
    error: "Invoice is required.",
  });
  assert.deepEqual(parseManualPaymentInput({ invoiceId: INVOICE_ID, totalPaidCents: 100 }), {
    ok: false,
    error: "Payment reference is required.",
  });
  assert.deepEqual(parseManualPaymentInput({
    invoiceId: "not-a-uuid",
    reference: "reference",
    totalPaidCents: 100,
  }), { ok: false, error: "Invoice is invalid." });
  assert.deepEqual(parseManualPaymentInput({
    invoiceId: INVOICE_ID,
    reference: "r".repeat(161),
    totalPaidCents: 100,
  }), { ok: false, error: "Payment reference must be 160 characters or fewer." });
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
  assert.deepEqual(parsePayoutSettingsInput({
    paymentProvider: "unsupported",
    payoutMode: "scheduled",
    earningsHoldDays: 0,
    minimumPayoutCents: 1,
  }), { ok: false, error: "Unsupported payout provider." });
  assert.deepEqual(parsePayoutSettingsInput({
    paymentProvider: "bitsafe",
    payoutMode: "unsupported",
    earningsHoldDays: 0,
    minimumPayoutCents: 1,
  }), { ok: false, error: "Unsupported payout mode." });
  assert.deepEqual(parsePayoutSettingsInput({
    paymentProvider: "bitsafe",
    payoutMode: "scheduled",
    earningsHoldDays: 91,
    minimumPayoutCents: 1,
  }), { ok: false, error: "Hold days must be between 0 and 90." });
  assert.deepEqual(parsePayoutSettingsInput({
    paymentProvider: "bitsafe",
    payoutMode: "scheduled",
    earningsHoldDays: 0,
    minimumPayoutCents: 0,
  }), { ok: false, error: "Minimum payout is invalid." });
});

test("earning management parsing preserves actions, trimming, and audit-reason limits", () => {
  for (const earningAction of ["hold", "release", "reverse"]) {
    assert.deepEqual(parseManageEarningInput({
      earningId: `  ${EARNING_ID}  `,
      earningAction,
      reason: "  reviewed  ",
    }), {
      ok: true,
      value: { earningId: EARNING_ID, earningAction, reason: "reviewed" },
    });
  }
  for (const reason of ["ab", "x".repeat(501)]) {
    assert.deepEqual(parseManageEarningInput({
      earningId: EARNING_ID,
      earningAction: "hold",
      reason,
    }), { ok: false, error: "Reason must be between 3 and 500 characters." });
  }
  assert.equal(parseManageEarningInput({
    earningId: EARNING_ID,
    earningAction: "hold",
    reason: "x".repeat(500),
  }).ok, true);
  assert.deepEqual(parseManageEarningInput({
    earningId: EARNING_ID,
    earningAction: "unsupported",
    reason: "reviewed",
  }), { ok: false, error: "Unsupported earning action." });
  assert.deepEqual(parseManageEarningInput({
    earningId: "not-a-uuid",
    earningAction: "hold",
    reason: "reviewed",
  }), { ok: false, error: "Earning is invalid." });
});

test("retry parsing preserves required payout and retry-reason contracts", () => {
  assert.deepEqual(parseRetryPayoutInput({ payoutId: `  ${PAYOUT_ID} `, reason: " retry " }), {
    ok: true,
    value: { payoutId: PAYOUT_ID, reason: "retry" },
  });
  assert.deepEqual(parseRetryPayoutInput({ payoutId: PAYOUT_ID, reason: "no" }), {
    ok: false,
    error: "Reason must be between 3 and 500 characters.",
  });
  assert.deepEqual(parseRetryPayoutInput({ reason: "retry" }), {
    ok: false,
    error: "Payout is required.",
  });
  assert.deepEqual(parseRetryPayoutInput({ payoutId: PAYOUT_ID }), {
    ok: false,
    error: "A retry reason is required.",
  });
  assert.deepEqual(parseRetryPayoutInput({ payoutId: "not-a-uuid", reason: "retry" }), {
    ok: false,
    error: "Payout is invalid.",
  });
});

test("Bitsafe reconciliation parsing preserves reference and reason boundaries", () => {
  const reconciliationReference = "r".repeat(160);
  assert.deepEqual(parseReconcileBitsafePayoutInput({
    payoutId: `  ${PAYOUT_ID}  `,
    reconciliationReference,
    reason: "  paid report reviewed  ",
  }), {
    ok: true,
    value: {
      payoutId: PAYOUT_ID,
      reconciliationReference,
      reason: "paid report reviewed",
    },
  });
  for (const input of [
    { payoutId: PAYOUT_ID, reconciliationReference: "r".repeat(161), reason: "reviewed" },
    { payoutId: PAYOUT_ID, reconciliationReference: "report", reason: "no" },
    { payoutId: PAYOUT_ID, reconciliationReference: "report", reason: "r".repeat(501) },
  ]) {
    assert.deepEqual(parseReconcileBitsafePayoutInput(input), {
      ok: false,
      error: "Reconciliation details are invalid.",
    });
  }
  assert.deepEqual(parseReconcileBitsafePayoutInput({ payoutId: PAYOUT_ID, reason: "reviewed" }), {
    ok: false,
    error: "Yoursafe report reference is required.",
  });
  assert.deepEqual(parseReconcileBitsafePayoutInput({
    payoutId: "not-a-uuid",
    reconciliationReference: "report",
    reason: "reviewed",
  }), { ok: false, error: "Payout is invalid." });
});
