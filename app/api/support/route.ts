import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createOwnSupportMessage, listOwnSupportThreads } from "@/src/lib/dancr/support";
import type { UserRole } from "@/src/lib/dancr/types";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
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
    if (account.role !== "customer" && account.role !== "dancer") {
      return NextResponse.json({ ok: false, error: "Support inbox is available for customer and dancer accounts." }, { status: 403 });
    }

    const body = await request.json();
    const thread = await createOwnSupportMessage(client, {
      userId: user.id,
      role: account.role,
      subject: typeof body.subject === "string" ? body.subject : "",
      body: typeof body.message === "string" ? body.message : "",
      threadId: typeof body.threadId === "string" ? body.threadId : "",
    });

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
