import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  AccountRecoveryRateLimitError,
  enforceAccountRecoveryRateLimit,
  type AccountRecoveryRole,
} from "@/src/lib/dancr/account-recovery";
import { sendTransactionalEmail } from "@/src/lib/dancr/notification-delivery";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECOVERY_MESSAGE = "Your request was received. MyDancr support will contact you at the email you provided after ownership is verified.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set<AccountRecoveryRole>(["customer", "dancer", "venue"]);

class AccountRecoveryInputError extends Error {}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const role = readRole(body.role);
    const accountName = boundedText(body.accountName, "Account name is required.", 2, 80);
    const city = boundedText(body.city, "City is required.", 2, 80);
    const contactEmail = readContactEmail(body.contactEmail);
    const details = optionalText(body.details, 1000);
    const client = createAdminSupabaseClient();

    await enforceAccountRecoveryRateLimit(client, {
      eventType: "email_lookup",
      role,
      request,
      subject: `${role}:${contactEmail}:${accountName}`,
    });

    const reportDetails = [
      "Account email recovery request",
      `Role: ${role}`,
      `Account name: ${accountName}`,
      `City: ${city}`,
      `Reply email: ${contactEmail}`,
      "",
      "Verification context supplied by requester:",
      details || "None provided",
      "",
      "Security: Do not reveal the registered email. Verify ownership before giving account access or sending recovery instructions.",
    ].join("\n");
    const { data, error } = await (client as any)
      .from("content_reports")
      .insert({
        reporter_id: null,
        target_type: "contact_message",
        target_id: null,
        target_label: `${role} account recovery · ${accountName}`,
        reason: "Forgot email/login",
        details: reportDetails,
        status: "open",
      })
      .select("id, created_at")
      .single();

    if (error) throw error;

    const reference = String(data.id);
    const supportEmail = process.env.ACCOUNT_RECOVERY_SUPPORT_EMAIL || "support@mydancr.com";
    const requesterText = [
      "We received your MyDancr sign-in email recovery request.",
      "",
      `Reference: ${reference}`,
      `Account type: ${role}`,
      `Account name: ${accountName}`,
      `City: ${city}`,
      "",
      "For your security, MyDancr will not reveal an account email until ownership is verified. Support will reply to this email if more information is needed.",
      "Never send a password, reset code, government ID, or payment information by email.",
    ].join("\n");
    const supportText = [
      "A signed-out visitor submitted an account email recovery request.",
      "",
      `Reference: ${reference}`,
      reportDetails,
      "",
      "Reply to the requester only after following the account recovery verification runbook.",
    ].join("\n");

    const deliveries = await Promise.allSettled([
      sendTransactionalEmail({
        to: contactEmail,
        subject: `MyDancr account recovery request ${reference}`,
        text: requesterText,
      }),
      sendTransactionalEmail({
        to: supportEmail,
        replyTo: contactEmail,
        subject: `[Account recovery] ${role} · ${accountName}`,
        text: supportText,
      }),
    ]);

    console.info(JSON.stringify({
      event: "account_recovery.email_lookup_requested",
      recoveryRequestId: reference,
      role,
      emailDeliveryAccepted: deliveries.map((delivery) => delivery.status === "fulfilled" && delivery.value.delivered),
    }));

    return NextResponse.json({ ok: true, message: RECOVERY_MESSAGE, reference });
  } catch (error) {
    if (error instanceof AccountRecoveryRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof AccountRecoveryInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error(JSON.stringify({
      event: "account_recovery.email_lookup_request_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }));
    return apiError(new Error("Unable to submit account recovery request."), "Unable to submit account recovery request.");
  }
}

function readRole(value: unknown): Exclude<AccountRecoveryRole, "admin"> {
  if (typeof value === "string" && ROLES.has(value as AccountRecoveryRole)) {
    return value as Exclude<AccountRecoveryRole, "admin">;
  }
  throw new AccountRecoveryInputError("Choose Guest, Dancer, or Venue.");
}

function readContactEmail(value: unknown) {
  const email = boundedText(value, "A reachable email is required.", 3, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new AccountRecoveryInputError("Enter a valid reachable email.");
  return email;
}

function boundedText(value: unknown, message: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min) throw new AccountRecoveryInputError(message);
  if (text.length > max) throw new AccountRecoveryInputError(`Keep this field under ${max} characters.`);
  if (/[<>]/.test(text)) throw new AccountRecoveryInputError("This field contains unsupported characters.");
  return text;
}

function optionalText(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) throw new AccountRecoveryInputError(`Keep the additional details under ${max} characters.`);
  if (/[<>]/.test(text)) throw new AccountRecoveryInputError("Additional details contain unsupported characters.");
  return text;
}
