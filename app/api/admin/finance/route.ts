import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { dispatchAdminFinanceAction } from "@/src/lib/dancr/finance-admin-dispatch";
import { getAdminFinanceOverview } from "@/src/lib/dancr/finance-reporting";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_FINANCE_ADMIN_BODY_BYTES = 16_384;

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
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_FINANCE_ADMIN_BODY_BYTES,
      invalidMessage: "Invalid finance admin request.",
      tooLargeMessage: "Finance admin request is too large.",
    });
    const admin = createAdminSupabaseClient();
    const result = await dispatchAdminFinanceAction(admin, user.id, body);
    return NextResponse.json({ ...result.body, session: session || null }, { status: result.status });
  } catch (error) {
    return apiError(error, "Unable to update QR finance operations.");
  }
}
