import type { PayoutMode, PayoutProviderName } from "./payout-provider";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const ADMIN_FINANCE_ACTIONS = [
  "run_automation",
  "process_payouts",
  "record_manual_payment",
  "update_payout_settings",
  "manage_earning",
  "retry_payout",
  "verify_nats_affiliate",
  "disable_nats_affiliate",
  "retry_nats_export",
  "reconcile_nats_export",
] as const;

export type AdminFinanceAction = (typeof ADMIN_FINANCE_ACTIONS)[number];

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

export type NatsAffiliateInput = {
  dancerId: string;
  reason: string;
};

export type NatsExportInput = {
  exportId: string;
  reason: string;
};

export type ReconcileNatsExportInput = NatsExportInput & {
  resolution: "confirmed_exported" | "confirmed_not_exported";
};
export type AdminFinanceCommand =
  | { action: "run_automation" }
  | { action: "process_payouts" }
  | ({ action: "record_manual_payment" } & ManualPaymentInput)
  | ({ action: "update_payout_settings" } & PayoutSettingsInput)
  | ({ action: "manage_earning" } & ManageEarningInput)
  | ({ action: "retry_payout" } & RetryPayoutInput)
  | ({ action: "verify_nats_affiliate" } & NatsAffiliateInput)
  | ({ action: "disable_nats_affiliate" } & NatsAffiliateInput)
  | ({ action: "retry_nats_export" } & NatsExportInput)
  | ({ action: "reconcile_nats_export" } & ReconcileNatsExportInput);

export function parseAdminFinanceCommand(input: unknown): ValidationResult<AdminFinanceCommand> {
  const request = parseAdminFinanceBody(input);
  if (!request.ok) return invalid(request.error);
  const body = request.value;
  const parsedAction = parseAdminFinanceAction(body);
  if (!parsedAction.ok) return invalid(parsedAction.error);
  const action = parsedAction.value;

  if (action === "run_automation" || action === "process_payouts") {
    return valid({ action });
  }

  if (action === "record_manual_payment") {
    const parsed = parseManualPaymentInput(body);
    return parsed.ok ? valid({ action, ...parsed.value }) : invalid(parsed.error);
  }

  if (action === "update_payout_settings") {
    const parsed = parsePayoutSettingsInput(body);
    return parsed.ok ? valid({ action, ...parsed.value }) : invalid(parsed.error);
  }

  if (action === "manage_earning") {
    const parsed = parseManageEarningInput(body);
    return parsed.ok ? valid({ action, ...parsed.value }) : invalid(parsed.error);
  }

  if (action === "retry_payout") {
    const parsed = parseRetryPayoutInput(body);
    return parsed.ok ? valid({ action, ...parsed.value }) : invalid(parsed.error);
  }

  if (action === "verify_nats_affiliate" || action === "disable_nats_affiliate") {
    const parsed = parseNatsAffiliateInput(body);
    return parsed.ok ? valid({ action, ...parsed.value }) : invalid(parsed.error);
  }

  if (action === "retry_nats_export") {
    const parsed = parseNatsExportInput(body);
    return parsed.ok ? valid({ action, ...parsed.value }) : invalid(parsed.error);
  }

  if (action === "reconcile_nats_export") {
    const parsed = parseNatsExportInput(body);
    if (!parsed.ok) return invalid(parsed.error);
    const resolution = oneOf(body.resolution, ["confirmed_exported", "confirmed_not_exported"] as const, "NATS reconciliation resolution is invalid.");
    return resolution.ok ? valid({ action, ...parsed.value, resolution: resolution.value }) : invalid(resolution.error);
  }
  return unsupportedAction(action);
}

export function parseAdminFinanceBody(input: unknown): ValidationResult<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("Invalid finance request.");
  }
  return valid(input as Record<string, unknown>);
}

export function parseAdminFinanceAction(body: Record<string, unknown>): ValidationResult<AdminFinanceAction> {
  return oneOf(body.action, ADMIN_FINANCE_ACTIONS, "Unsupported finance action.");
}

export function parseManualPaymentInput(body: Record<string, unknown>): ValidationResult<ManualPaymentInput> {
  const invoiceId = requiredUuid(body.invoiceId, "Invoice is required.", "Invoice is invalid.");
  if (!invoiceId.ok) return invoiceId;
  const reference = requiredText(body.reference, "Payment reference is required.");
  if (!reference.ok) return reference;
  if (reference.value.length > 160) {
    return invalid("Payment reference must be 160 characters or fewer.");
  }
  const totalPaidCents = boundedInteger(
    body.totalPaidCents,
    1,
    Number.MAX_SAFE_INTEGER,
    "Payment total must be a positive whole number of cents.",
  );
  if (!totalPaidCents.ok) return totalPaidCents;
  return valid({ invoiceId: invoiceId.value, reference: reference.value, totalPaidCents: totalPaidCents.value });
}

export function parsePayoutSettingsInput(body: Record<string, unknown>): ValidationResult<PayoutSettingsInput> {
  const payoutsEnabled = requiredBoolean(body.payoutsEnabled, "Payouts enabled must be true or false.");
  if (!payoutsEnabled.ok) return payoutsEnabled;
  const paymentProvider = oneOf(body.paymentProvider, ["stripe", "adyen", "other"] as const, "Unsupported payout provider.");
  if (!paymentProvider.ok) return paymentProvider;
  const payoutMode = oneOf(body.payoutMode, ["manual_cashout", "scheduled", "both"] as const, "Unsupported payout mode.");
  if (!payoutMode.ok) return payoutMode;
  const earningsHoldDays = boundedInteger(body.earningsHoldDays, 0, 90, "Hold days must be between 0 and 90.");
  if (!earningsHoldDays.ok) return earningsHoldDays;
  const minimumPayoutCents = boundedInteger(body.minimumPayoutCents, 1, 10_000_000, "Minimum payout is invalid.");
  if (!minimumPayoutCents.ok) return minimumPayoutCents;
  return valid({
    payoutsEnabled: payoutsEnabled.value,
    paymentProvider: paymentProvider.value,
    payoutMode: payoutMode.value,
    earningsHoldDays: earningsHoldDays.value,
    minimumPayoutCents: minimumPayoutCents.value,
  });
}

export function parseManageEarningInput(body: Record<string, unknown>): ValidationResult<ManageEarningInput> {
  const earningId = requiredUuid(body.earningId, "Earning is required.", "Earning is invalid.");
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
  const payoutId = requiredUuid(body.payoutId, "Payout is required.", "Payout is invalid.");
  if (!payoutId.ok) return payoutId;
  const reason = requiredText(body.reason, "A retry reason is required.");
  if (!reason.ok) return reason;
  if (reason.value.length < 3 || reason.value.length > 500) {
    return invalid("Reason must be between 3 and 500 characters.");
  }
  return valid({ payoutId: payoutId.value, reason: reason.value });
}

export function parseNatsAffiliateInput(body: Record<string, unknown>): ValidationResult<NatsAffiliateInput> {
  const dancerId = requiredUuid(body.dancerId, "Dancer is required.", "Dancer is invalid.");
  if (!dancerId.ok) return dancerId;
  const reason = auditReason(body.reason);
  return reason.ok ? valid({ dancerId: dancerId.value, reason: reason.value }) : invalid(reason.error);
}

export function parseNatsExportInput(body: Record<string, unknown>): ValidationResult<NatsExportInput> {
  const exportId = requiredUuid(body.exportId, "NATS export is required.", "NATS export is invalid.");
  if (!exportId.ok) return exportId;
  const reason = auditReason(body.reason);
  return reason.ok ? valid({ exportId: exportId.value, reason: reason.value }) : invalid(reason.error);
}

function auditReason(value: unknown) {
  const reason = requiredText(value, "A financial audit reason is required.");
  if (!reason.ok) return reason;
  return reason.value.length >= 3 && reason.value.length <= 500
    ? reason
    : invalid<string>("Reason must be between 3 and 500 characters.");
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

function requiredUuid(value: unknown, requiredMessage: string, invalidMessage: string) {
  const text = requiredText(value, requiredMessage);
  if (!text.ok) return text;
  if (!UUID_PATTERN.test(text.value)) return invalid<string>(invalidMessage);
  return text;
}

function requiredBoolean(value: unknown, message: string) {
  return typeof value === "boolean" ? valid(value) : invalid<boolean>(message);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, message: string) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^(0|[1-9]\d*)$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return invalid<number>(message);
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

function unsupportedAction(action: never): ValidationResult<AdminFinanceCommand> {
  void action;
  return invalid("Unsupported finance action.");
}
