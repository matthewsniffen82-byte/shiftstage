import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { listAdminSupportThreads, replyToSupportThread } from "@/src/lib/dancr/support";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_SUPPORT_REPLY_BODY_BYTES = 24_576;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const threads = await listAdminSupportThreads(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, threads, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load support inbox.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_SUPPORT_REPLY_BODY_BYTES,
      invalidMessage: "Invalid support reply request.",
      tooLargeMessage: "Support reply request is too large.",
    });
    const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
    if (!threadId) return NextResponse.json({ ok: false, error: "Missing support thread." }, { status: 400 });
    if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))) {
      throw new PublicApiError("INVALID_REQUEST", "Invalid reply request. Refresh and try again.", 400);
    }

    const thread = await replyToSupportThread(createAdminSupabaseClient(), {
      adminId: user.id,
      threadId,
      body: typeof body.message === "string" ? body.message : "",
      requestId: typeof body.requestId === "string" ? body.requestId : null,
    });

    return NextResponse.json({ ok: true, thread, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to reply to support message.");
  }
}
