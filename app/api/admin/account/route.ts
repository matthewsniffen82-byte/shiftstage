import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { EMAIL_ACTION_HEADERS, isUsernameOnlyAdminEmail, sendAdminEmailChange } from "@/src/lib/dancr/email-actions";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "workspace");
    const usernameOnly = isUsernameOnlyAdminEmail(user.email || "");
    return NextResponse.json({ ok: true, userId: user.id, email: usernameOnly ? null : user.email,
      username: usernameOnly ? user.email!.split("@")[0] : null, usernameOnly, session }, { headers: EMAIL_ACTION_HEADERS });
  } catch (error) { return accountError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "workspace");
    const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Enter your new email and current password.", tooLargeMessage: "Request too large." });
    const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!newEmail || newEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new PublicApiError("INVALID_REQUEST", "Enter a valid email address.", 400);
    }
    if (!currentPassword || currentPassword.length > 1024) throw new PublicApiError("INVALID_REQUEST", "Enter your current password.", 400);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "admin_email_change", request, subject: user.id,
      windowSeconds: 900, ipLimit: 20, subjectLimit: 5 });
    const result = await sendAdminEmailChange(admin, { userId: user.id, newEmail, currentPassword });
    return NextResponse.json({ ok: true, userId: user.id, ...result, session,
      message: result.needsCurrentInbox
        ? `Confirm the links in both your current inbox and ${result.newEmail}. Your email stays unchanged until both are confirmed.`
        : `Check ${result.newEmail} and confirm the link. After confirmation, sign in with that email and your existing password instead of your username.`,
    }, { headers: EMAIL_ACTION_HEADERS });
  } catch (error) { return accountError(error); }
}

function accountError(error: unknown) {
  if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, {
    status: 429, headers: { ...EMAIL_ACTION_HEADERS, "retry-after": String(error.retryAfterSeconds) },
  });
  const response = apiError(error, "Unable to update your admin email. Please try again.");
  for (const [key, value] of Object.entries(EMAIL_ACTION_HEADERS)) response.headers.set(key, value);
  return response;
}
