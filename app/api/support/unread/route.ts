import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { isSupportUserRole } from "@/src/lib/dancr/support";
import { countUnreadSupportMessages, markSupportMessagesRead, parseReadMessageIds } from "@/src/lib/dancr/support-unread";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

async function authorize(request: Request) {
  const { client, session, user } = await createRequestSupabaseContext(request);
  const { data: account, error } = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  if (error) throw error;
  const admin = account?.role === "admin";
  if (admin) await requireAdmin(client, user.id, "support");
  else if (!isSupportUserRole(account?.role)) throw new PublicApiError("FORBIDDEN", "Messaging is unavailable for this account.", 403);
  return { reader: { userId: user.id, admin }, session };
}

export async function GET(request: Request) {
  try {
    const { reader, session } = await authorize(request);
    const unreadCount = await countUnreadSupportMessages(createAdminSupabaseClient(), reader);
    return NextResponse.json({ ok: true, unreadCount, session: session || null }, { headers });
  } catch (error) {
    return apiError(error, "Unable to check unread messages.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { reader, session } = await authorize(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid read receipt.", tooLargeMessage: "Too many messages." });
    const ids = parseReadMessageIds(body.messageIds);
    const readIds = await markSupportMessagesRead(createAdminSupabaseClient(), reader, ids);
    return NextResponse.json({ ok: true, readIds, session: session || null }, { headers });
  } catch (error) {
    return apiError(error, "Unable to mark messages as read.");
  }
}
