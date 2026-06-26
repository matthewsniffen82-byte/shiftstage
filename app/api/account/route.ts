import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId, setAccountState } from "@/src/lib/dancr/auth";
import type { AccountState } from "@/src/lib/dancr/types";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCHABLE_STATES = new Set<AccountState>(["active", "disabled"]);

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);

    if (!account) {
      return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return apiError(error, "Unable to load account.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const accountState = body?.accountState;

    if (!PATCHABLE_STATES.has(accountState)) {
      return NextResponse.json({ ok: false, error: "Account state must be active or disabled." }, { status: 400 });
    }

    const account = await setAccountState(client, user.id, accountState);
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return apiError(error, "Unable to update account.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await setAccountState(client, user.id, "deleted");

    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return apiError(error, "Unable to delete account.");
  }
}
