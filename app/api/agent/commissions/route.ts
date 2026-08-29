import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getNatsRuntimeConfig } from "@/src/lib/dancr/nats";
import { requestNatsAgentAffiliateLink } from "@/src/lib/dancr/nats-agent-affiliate-actions";
import { agentStatementCsv, getAgentCommissionDashboard } from "@/src/lib/dancr/sales-agents";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_AGENT_ACTION_BODY_BYTES = 2_048;

export async function GET(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { user } = authContext;
    const url = new URL(request.url);
    const admin = createAdminSupabaseClient();
    if (url.searchParams.get("access") === "1") {
      const { data, error } = await (admin as any).from("sales_agents")
        .select("id").eq("user_id", user.id).eq("status", "active").maybeSingle();
      if (error) throw error;
      return NextResponse.json(
        {
          ok: true,
          access: { active: Boolean(data?.id) },
          session: authContext.session || null,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const dashboard = await getAgentCommissionDashboard(admin, user.id);
    if (url.searchParams.get("format") === "csv") {
      return new Response(agentStatementCsv(dashboard), { headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="mydancr-agent-statement-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "private, no-store",
      } });
    }
    return NextResponse.json({
      ok: true,
      dashboard,
      session: authContext.session || null,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load agent commissions.");
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { user } = authContext;
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_AGENT_ACTION_BODY_BYTES,
      invalidMessage: "Invalid sales agent request.",
      tooLargeMessage: "Sales agent request is too large.",
    });
    if (body.action !== "request_nats_link") {
      return NextResponse.json({ ok: false, error: "Unsupported sales agent action." }, { status: 400 });
    }
    if (!getNatsRuntimeConfig().selected) {
      return NextResponse.json({ ok: false, error: "NATS commission settlement is not currently selected." }, { status: 409 });
    }
    const loginId = Number(body.loginId);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!Number.isSafeInteger(loginId) || loginId < 1 || username.length > 80) {
      return NextResponse.json({ ok: false, error: "Enter a valid NATS affiliate login ID and optional username." }, { status: 400 });
    }
    const admin = createAdminSupabaseClient();
    await requestNatsAgentAffiliateLink(admin, user.id, { loginId, username: username || null });
    return NextResponse.json({
      ok: true,
      dashboard: await getAgentCommissionDashboard(admin, user.id),
      session: authContext.session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to link the NATS agent account.");
  }
}
