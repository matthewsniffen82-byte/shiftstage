import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getAccountByUserId, setAccountState } from "@/src/lib/dancr/auth";
import { sendTransactionalEmail } from "@/src/lib/dancr/notification-delivery";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
import type { AccountState } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ACCOUNT_BODY_BYTES = 8_192;

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);

    if (!account) {
      return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, account, session });
  } catch (error) {
    return apiError(error, "Unable to load account.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_ACCOUNT_BODY_BYTES,
      invalidMessage: "Invalid account update request.",
      tooLargeMessage: "Account update request is too large.",
    });
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (email) {
      if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
        return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
      }

      const origin = publicAppUrl();
      const emailRedirectTo = `${origin}/auth/callback?role=customer&return_to=${encodeURIComponent("/dashboard/customer")}`;
      const { error } = await client.auth.updateUser({ email }, { emailRedirectTo });

      if (error) {
        console.warn("ACCOUNT_EMAIL_UPDATE_REJECTED", { userId: user.id, code: error.code || "auth_error" });
        return NextResponse.json({ ok: false, error: "Unable to update email. Check the address and try again." }, { status: 400 });
      }

      const account = await getAccountByUserId(client, user.id);
      return NextResponse.json({
        ok: true,
        account,
        session,
        message: "Check your new email address to confirm the change.",
      });
    }

    if (password) {
      if (password.length < 8) {
        return NextResponse.json({ ok: false, error: "Password must be at least 8 characters." }, { status: 400 });
      }
      if (password.length > 1_024) {
        return NextResponse.json({ ok: false, error: "Password is too long." }, { status: 400 });
      }

      const { error } = await client.auth.updateUser({ password });

      if (error) {
        console.warn("ACCOUNT_PASSWORD_UPDATE_REJECTED", { userId: user.id, code: error.code || "auth_error" });
        return NextResponse.json({ ok: false, error: "Unable to update password. Check the password and try again." }, { status: 400 });
      }

      const { error: signOutError } = await client.auth.signOut({ scope: "others" });
      if (signOutError) {
        console.warn(JSON.stringify({
          event: "account.password_other_sessions_revoke_failed",
          userId: user.id,
          message: signOutError.message,
        }));
      }

      if (user.email) {
        const delivery = await sendTransactionalEmail({
          to: user.email,
          subject: "Your MyDancr password was changed",
          text: [
            "Your MyDancr password was changed successfully.",
            "",
            "Other active MyDancr sessions were signed out for your security.",
            "If you did not make this change, reset your password immediately from the MyDancr sign-in page and contact support@mydancr.com.",
            "",
            "MyDancr will never ask you to send your password or reset code by email.",
          ].join("\n"),
        });
        if (!delivery.delivered) {
          console.warn(JSON.stringify({
            event: "account.password_change_alert_delivery_failed",
            userId: user.id,
            reason: delivery.reason,
          }));
        }
      }

      const account = await getAccountByUserId(client, user.id);
      return NextResponse.json({ ok: true, account, session, message: "Password updated. Other sessions were signed out." });
    }

    if (body.accountState !== "active" && body.accountState !== "disabled") {
      return NextResponse.json({ ok: false, error: "Account state must be active or disabled." }, { status: 400 });
    }
    const accountState: AccountState = body.accountState;

    const account = await setAccountState(client, user.id, accountState, createAdminSupabaseClient());
    console.info(JSON.stringify({
      event: accountState === "disabled" ? "account.self_disabled" : "account.self_reactivated",
      userId: user.id,
      role: account.role,
    }));
    return NextResponse.json({ ok: true, account, session });
  } catch (error) {
    return apiError(error, "Unable to update account.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const admin = createAdminSupabaseClient();
    const account = await setAccountState(client, user.id, "deleted", admin);
    console.info(JSON.stringify({ event: "account.self_deleted", userId: user.id, role: account.role }));
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);

    if (deleteUserError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Account was marked deleted, but the login could not be removed. Contact admin before signing up again with this email.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return apiError(error, "Unable to delete account.");
  }
}
