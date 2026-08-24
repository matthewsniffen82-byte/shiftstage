import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { dispatchAdminFinanceAction } from "@/src/lib/dancr/finance-admin-dispatch";
import { getAdminFinanceOverview } from "@/src/lib/dancr/finance-reporting";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const finance = await getAdminFinanceOverview(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, finance, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load QR finance operations.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();
    const result = await dispatchAdminFinanceAction(admin, user.id, body);
    return NextResponse.json({ ...result.body, session: session || null }, { status: result.status });
  } catch (error) {
    return apiError(error, "Unable to update QR finance operations.");
  }
}
