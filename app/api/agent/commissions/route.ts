import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { agentStatementCsv, getAgentCommissionDashboard } from "@/src/lib/dancr/sales-agents";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const dashboard = await getAgentCommissionDashboard(createAdminSupabaseClient(), user.id);
    if (new URL(request.url).searchParams.get("format") === "csv") {
      return new Response(agentStatementCsv(dashboard), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="mydancr-agent-statement-${new Date().toISOString().slice(0, 10)}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    }
    return NextResponse.json({ ok: true, dashboard }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "Unable to load agent commissions.");
  }
}
