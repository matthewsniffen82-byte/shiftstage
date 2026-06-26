import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAdminSubscriptions, requireAdmin } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const status = new URL(request.url).searchParams.get("status");
    const subscriptions = await getAdminSubscriptions(createAdminSupabaseClient(), status);

    return NextResponse.json({ ok: true, subscriptions });
  } catch (error) {
    return apiError(error, "Unable to load admin subscriptions.");
  }
}
