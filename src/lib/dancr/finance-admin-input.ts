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

export function parseAdminFinanceBody(input: unknown): ValidationResult<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("Invalid finance request.");
  }
  return valid(input as Record<string, unknown>);
}

export function parseManualPaymentInput(body: Record<string, unknown>): ValidationResult<ManualPaymentInput> {
  const invoiceId = requiredText(body.invoiceId, "Invoice is required.");
  if (!invoiceId.ok) return invoiceId;
  const reference = requiredText(body.reference, "Payment reference is required.");
  if (!reference.ok) return reference;
  const totalPaidCents = Number(body.totalPaidCents);
  if (!Number.isInteger(totalPaidCents) || totalPaidCents <= 0) {
    return invalid("Payment total must be a positive whole number of cents.");
  }
  return valid({ invoiceId: invoiceId.value, reference: reference.value, totalPaidCents });
}

export function parsePayoutSettingsInput(body: Record<string, unknown>): ValidationResult<PayoutSettingsInput> {
  const paymentProvider = oneOf(body.paymentProvider, ["stripe", "bitsafe", "adyen", "other"] as const, "Unsupported payout provider.");
  if (!paymentProvider.ok) return paymentProvider;
  const payoutMode = oneOf(body.payoutMode, ["manual_cashout", "scheduled", "both"] as const, "Unsupported payout mode.");
  if (!payoutMode.ok) return payoutMode;
  const earningsHoldDays = boundedInteger(body.earningsHoldDays, 0, 90, "Hold days must be between 0 and 90.");
  if (!earningsHoldDays.ok) return earningsHoldDays;
  const minimumPayoutCents = boundedInteger(body.minimumPayoutCents, 1, 10_000_000, "Minimum payout is invalid.");
  if (!minimumPayoutCents.ok) return minimumPayoutCents;
  return valid({
    payoutsEnabled: body.payoutsEnabled === true,
    paymentProvider: paymentProvider.value,
    payoutMode: payoutMode.value,
    earningsHoldDays: earningsHoldDays.value,
    minimumPayoutCents: minimumPayoutCents.value,
  });
}

export function parseManageEarningInput(body: Record<string, unknown>): ValidationResult<ManageEarningInput> {
  const earningId = requiredText(body.earningId, "Earning is required.");
  if (!earningId.ok) return earningId;
  const earningAction = oneOf(body.earningAction, ["hold", "release", "reverse"] as const, "Unsupported earning action.");
  if (!earningAction.ok) return earningAction;
  const reason = requiredText(body.reason, "A financial audit reason is required.");
  if (!reason.ok) return reason;
  if (reason.value.length < 3 || reason.value.length > 500) {
    return invalid("Reason must be between 3 and 500 characters.");
  }
  return valid({ earningId: earningId.value, earningAction: earningAction.value, reason: reason.value });
}

export function parseRetryPayoutInput(body: Record<string, unknown>): ValidationResult<RetryPayoutInput> {
  const payoutId = requiredText(body.payoutId, "Payout is required.");
  if (!payoutId.ok) return payoutId;
  const reason = requiredText(body.reason, "A retry reason is required.");
  if (!reason.ok) return reason;
  if (reason.value.length < 3 || reason.value.length > 500) {
    return invalid("Reason must be between 3 and 500 characters.");
  }
  return valid({ payoutId: payoutId.value, reason: reason.value });
}

export function parseReconcileBitsafePayoutInput(
  body: Record<string, unknown>,
): ValidationResult<ReconcileBitsafePayoutInput> {
  const payoutId = requiredText(body.payoutId, "Payout is required.");
  if (!payoutId.ok) return payoutId;
  const reconciliationReference = requiredText(body.reconciliationReference, "Yoursafe report reference is required.");
  if (!reconciliationReference.ok) return reconciliationReference;
  const reason = requiredText(body.reason, "A reconciliation reason is required.");
  if (!reason.ok) return reason;
  if (reconciliationReference.value.length > 160 || reason.value.length < 3 || reason.value.length > 500) {
    return invalid("Reconciliation details are invalid.");
  }
  return valid({
    payoutId: payoutId.value,
    reconciliationReference: reconciliationReference.value,
    reason: reason.value,
  });
}

function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function invalid<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) return invalid<string>(message);
  return valid(value.trim());
}

function boundedInteger(value: unknown, minimum: number, maximum: number, message: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return invalid<number>(message);
  return valid(parsed);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  message: string,
): ValidationResult<T[number]> {
  if (typeof value !== "string" || !allowed.includes(value)) return invalid<T[number]>(message);
  return valid(value as T[number]);
}
