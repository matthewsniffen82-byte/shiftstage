import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  createOwnSupportMessage,
  isSupportUserRole,
  listOwnSupportThreads,
} from "@/src/lib/dancr/support";
import type { UserRole } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_SUPPORT_MESSAGE_BODY_BYTES = 24_576;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getOwnAccount(client, user.id);
    if (!isSupportUserRole(account.role)) {
      return NextResponse.json({ ok: false, error: "Support messaging is available for guest, dancer, and venue accounts." }, { status: 403 });
    }
    const threads = await listOwnSupportThreads(client, user.id);
    return NextResponse.json({ ok: true, threads });
  } catch (error) {
    return apiError(error, "Unable to load support inbox.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getOwnAccount(client, user.id);
    if (!isSupportUserRole(account.role)) {
      return NextResponse.json({ ok: false, error: "Support messaging is available for guest, dancer, and venue accounts." }, { status: 403 });
    }

    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_SUPPORT_MESSAGE_BODY_BYTES,
      invalidMessage: "Invalid support message request.",
      tooLargeMessage: "Support message request is too large.",
    });
    const thread = await createOwnSupportMessage(
      client,
      {
        userId: user.id,
        role: account.role,
        subject: typeof body.subject === "string" ? body.subject : "",
        body: typeof body.message === "string" ? body.message : "",
        threadId: typeof body.threadId === "string" ? body.threadId : "",
      },
      createAdminSupabaseClient(),
    );
    return NextResponse.json({ ok: true, thread });
  } catch (error) {
    return apiError(error, "Unable to send support message.");
  }
}

async function getOwnAccount(client: any, userId: string): Promise<{ role: UserRole }> {
  const { data, error } = await client
    .from("app_users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Account not found.");
  return { role: data.role };
}
