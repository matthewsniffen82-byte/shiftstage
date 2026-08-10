import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getDancerDealMetrics } from "@/src/lib/dancr/deals";
import { getOwnDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { getDancerFinance } from "@/src/lib/dancr/finance";
import { finalizePendingDancerNfcEnrollment } from "@/src/lib/dancr/nfc";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "dancer" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
    }
    const admin = createAdminSupabaseClient();
    const nfcEnrollment = await finalizePendingDancerNfcEnrollment(admin, { dancerUserId: user.id, request });
    const [analytics, deals, finance] = await Promise.all([
      getOwnDancerDashboardAnalytics(client, user.id),
      getDancerDealMetrics(client, user.id),
      getDancerFinance(admin, user.id),
    ]);

    return NextResponse.json({ ok: true, analytics, deals, finance, nfcEnrollment });
  } catch (error) {
    return apiError(error, "Unable to load dancer dashboard.");
  }
}
