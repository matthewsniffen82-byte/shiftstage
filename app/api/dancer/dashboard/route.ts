import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getDancerDealMetrics } from "@/src/lib/dancr/deals";
import { getOwnDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { getDancerFinance } from "@/src/lib/dancr/finance";
import { getDancerNfcDashboardState } from "@/src/lib/dancr/nfc";
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
    const [analytics, deals, finance, nfc] = await Promise.all([
      getOwnDancerDashboardAnalytics(client, user.id),
      getDancerDealMetrics(client, user.id),
      getDancerFinance(admin, user.id),
      getDancerNfcDashboardState(admin, user.id),
    ]);

    return NextResponse.json({
      ok: true,
      analytics,
      deals,
      finance,
      nfc,
      affiliations: nfc.affiliations,
    });
  } catch (error) {
    return apiError(error, "Unable to load dancer dashboard.");
  }
}
