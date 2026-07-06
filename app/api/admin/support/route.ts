import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { listAdminSupportThreads, replyToSupportThread } from "@/src/lib/dancr/support";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const threads = await listAdminSupportThreads(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, threads });
  } catch (error) {
    return apiError(error, "Unable to load support inbox.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json();
    const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
    if (!threadId) return NextResponse.json({ ok: false, error: "Missing support thread." }, { status: 400 });

    const thread = await replyToSupportThread(createAdminSupabaseClient(), {
      adminId: user.id,
      threadId,
      body: typeof body.message === "string" ? body.message : "",
    });

    return NextResponse.json({ ok: true, thread });
  } catch (error) {
    return apiError(error, "Unable to reply to support message.");
  }
}
