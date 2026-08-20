import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  manageDancerEarning,
  reconcileBitsafePayout,
  recordManualClubInvoicePayment,
  retryDancerPayout,
  updatePayoutSettings,
} from "@/src/lib/dancr/finance-admin-actions";
import {
  getAdminFinanceOverview,
  processDancerPayouts,
  runQrFinanceAutomation,
} from "@/src/lib/dancr/finance";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const finance = await getAdminFinanceOverview(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, finance });
  } catch (error) {
    return apiError(error, "Unable to load QR finance operations.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();

    if (body.action === "run_automation") {
      const result = await runQrFinanceAutomation(admin);
      return NextResponse.json({ ok: true, result, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "process_payouts") {
      const result = await processDancerPayouts(admin);
      return NextResponse.json({ ok: true, result, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "record_manual_payment") {
      const invoiceId = requiredText(body.invoiceId, "Invoice is required.");
      const reference = requiredText(body.reference, "Payment reference is required.");
      const totalPaidCents = Number(body.totalPaidCents);
      if (!Number.isInteger(totalPaidCents) || totalPaidCents <= 0) {
        return NextResponse.json({ ok: false, error: "Payment total must be a positive whole number of cents." }, { status: 400 });
      }
      await recordManualClubInvoicePayment(admin, invoiceId, totalPaidCents, reference);
      return NextResponse.json({ ok: true, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "update_payout_settings") {
      const paymentProvider = oneOf(body.paymentProvider, ["stripe", "bitsafe", "adyen", "other"] as const, "Unsupported payout provider.");
      const payoutMode = oneOf(body.payoutMode, ["manual_cashout", "scheduled", "both"] as const, "Unsupported payout mode.");
      const earningsHoldDays = boundedInteger(body.earningsHoldDays, 0, 90, "Hold days must be between 0 and 90.");
      const minimumPayoutCents = boundedInteger(body.minimumPayoutCents, 1, 10_000_000, "Minimum payout is invalid.");
      await updatePayoutSettings(admin, user.id, {
        payoutsEnabled: body.payoutsEnabled === true,
        paymentProvider,
        payoutMode,
        earningsHoldDays,
        minimumPayoutCents,
      });
      return NextResponse.json({ ok: true, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "manage_earning") {
      const earningId = requiredText(body.earningId, "Earning is required.");
      const earningAction = oneOf(body.earningAction, ["hold", "release", "reverse"] as const, "Unsupported earning action.");
      const reason = requiredText(body.reason, "A financial audit reason is required.");
      if (reason.length < 3 || reason.length > 500) {
        return NextResponse.json({ ok: false, error: "Reason must be between 3 and 500 characters." }, { status: 400 });
      }
      await manageDancerEarning(admin, user.id, earningId, earningAction, reason);
      return NextResponse.json({ ok: true, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "retry_payout") {
      const payoutId = requiredText(body.payoutId, "Payout is required.");
      const reason = requiredText(body.reason, "A retry reason is required.");
      if (reason.length < 3 || reason.length > 500) {
        return NextResponse.json({ ok: false, error: "Reason must be between 3 and 500 characters." }, { status: 400 });
      }
      await retryDancerPayout(admin, user.id, payoutId, reason);
      return NextResponse.json({ ok: true, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "reconcile_bitsafe_payout") {
      const payoutId = requiredText(body.payoutId, "Payout is required.");
      const reconciliationReference = requiredText(body.reconciliationReference, "Yoursafe report reference is required.");
      const reason = requiredText(body.reason, "A reconciliation reason is required.");
      if (reconciliationReference.length > 160 || reason.length < 3 || reason.length > 500) {
        return NextResponse.json({ ok: false, error: "Reconciliation details are invalid." }, { status: 400 });
      }
      await reconcileBitsafePayout(admin, user.id, payoutId, reconciliationReference, reason);
      return NextResponse.json({ ok: true, finance: await getAdminFinanceOverview(admin) });
    }

    return NextResponse.json({ ok: false, error: "Unsupported finance action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to update QR finance operations.");
  }
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
