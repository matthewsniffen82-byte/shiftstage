import type { PayoutMode, PayoutProviderName } from "./payout-provider";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ManualPaymentInput = {
  invoiceId: string;
  reference: string;
  totalPaidCents: number;
};

export type PayoutSettingsInput = {
  payoutsEnabled: boolean;
  paymentProvider: PayoutProviderName;
  payoutMode: PayoutMode;
  earningsHoldDays: number;
  minimumPayoutCents: number;
};

export type ManageEarningInput = {
  earningId: string;
  earningAction: "hold" | "release" | "reverse";
  reason: string;
};

export type RetryPayoutInput = {
  payoutId: string;
  reason: string;
};

export type ReconcileBitsafePayoutInput = {
  payoutId: string;
  reconciliationReference: string;
  reason: string;
};

export function parseManualPaymentInput(body: Record<string, unknown>): ValidationResult<ManualPaymentInput> {
  const invoiceId = requiredText(body.invoiceId, "Invoice is required.");
  const reference = requiredText(body.reference, "Payment reference is required.");
  const totalPaidCents = Number(body.totalPaidCents);
  if (!Number.isInteger(totalPaidCents) || totalPaidCents <= 0) {
    return invalid("Payment total must be a positive whole number of cents.");
  }
  return valid({ invoiceId, reference, totalPaidCents });
}

export function parsePayoutSettingsInput(body: Record<string, unknown>): ValidationResult<PayoutSettingsInput> {
  const paymentProvider = oneOf(body.paymentProvider, ["stripe", "bitsafe", "adyen", "other"] as const, "Unsupported payout provider.");
  const payoutMode = oneOf(body.payoutMode, ["manual_cashout", "scheduled", "both"] as const, "Unsupported payout mode.");
  const earningsHoldDays = boundedInteger(body.earningsHoldDays, 0, 90, "Hold days must be between 0 and 90.");
  const minimumPayoutCents = boundedInteger(body.minimumPayoutCents, 1, 10_000_000, "Minimum payout is invalid.");
  return valid({
    payoutsEnabled: body.payoutsEnabled === true,
    paymentProvider,
    payoutMode,
    earningsHoldDays,
    minimumPayoutCents,
  });
}

export function parseManageEarningInput(body: Record<string, unknown>): ValidationResult<ManageEarningInput> {
  const earningId = requiredText(body.earningId, "Earning is required.");
  const earningAction = oneOf(body.earningAction, ["hold", "release", "reverse"] as const, "Unsupported earning action.");
  const reason = requiredText(body.reason, "A financial audit reason is required.");
  if (reason.length < 3 || reason.length > 500) {
    return invalid("Reason must be between 3 and 500 characters.");
  }
  return valid({ earningId, earningAction, reason });
}

export function parseRetryPayoutInput(body: Record<string, unknown>): ValidationResult<RetryPayoutInput> {
  const payoutId = requiredText(body.payoutId, "Payout is required.");
  const reason = requiredText(body.reason, "A retry reason is required.");
  if (reason.length < 3 || reason.length > 500) {
    return invalid("Reason must be between 3 and 500 characters.");
  }
  return valid({ payoutId, reason });
}

export function parseReconcileBitsafePayoutInput(
  body: Record<string, unknown>,
): ValidationResult<ReconcileBitsafePayoutInput> {
  const payoutId = requiredText(body.payoutId, "Payout is required.");
  const reconciliationReference = requiredText(body.reconciliationReference, "Yoursafe report reference is required.");
  const reason = requiredText(body.reason, "A reconciliation reason is required.");
  if (reconciliationReference.length > 160 || reason.length < 3 || reason.length > 500) {
    return invalid("Reconciliation details are invalid.");
  }
  return valid({ payoutId, reconciliationReference, reason });
}

function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function invalid<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function boundedInteger(value: unknown, minimum: number, maximum: number, message: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(message);
  return parsed;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, message: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(message);
  return value as T[number];
}
