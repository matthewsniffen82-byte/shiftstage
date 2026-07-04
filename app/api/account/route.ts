import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId, setAccountState } from "@/src/lib/dancr/auth";
import type { AccountState } from "@/src/lib/dancr/types";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCHABLE_STATES = new Set<AccountState>(["active", "disabled"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (email) {
      if (!EMAIL_PATTERN.test(email)) {
        return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
      }

      const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "https://www.mydancr.com";
      const emailRedirectTo = `${origin}/auth/callback?role=customer&return_to=${encodeURIComponent("/dashboard/customer")}`;
      const { error } = await client.auth.updateUser({ email }, { emailRedirectTo });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message || "Unable to update email." }, { status: 400 });
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

      const { error } = await client.auth.updateUser({ password });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message || "Unable to update password." }, { status: 400 });
      }

      const account = await getAccountByUserId(client, user.id);
      return NextResponse.json({ ok: true, account, session, message: "Password updated." });
    }

    const accountState = body?.accountState;

    if (!PATCHABLE_STATES.has(accountState)) {
      return NextResponse.json({ ok: false, error: "Account state must be active or disabled." }, { status: 400 });
    }

    const account = await setAccountState(client, user.id, accountState);
    return NextResponse.json({ ok: true, account, session });
  } catch (error) {
    return apiError(error, "Unable to update account.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const account = await setAccountState(client, user.id, "deleted");

    return NextResponse.json({ ok: true, account, session });
  } catch (error) {
    return apiError(error, "Unable to delete account.");
  }
}
