import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  disableNatsAgentAffiliateLink, reconcileNatsAgentCommissionExport,
  retryFailedNatsAgentCommissionExport, verifyNatsAgentAffiliateLink,
} from "@/src/lib/dancr/nats-agent-affiliate-actions";
import { assignAdminVenueSalesAgent, getAdminSalesAgentProgram, setAdminSalesAgent } from "@/src/lib/dancr/sales-agents";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request); await requireAdmin(client, user.id);
    return NextResponse.json({ ok: true, program: await getAdminSalesAgentProgram(createAdminSupabaseClient()) },
      { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load the sales agent program."); }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request); await requireAdmin(client, user.id);
    const body = await request.json().catch(() => ({})); const admin = createAdminSupabaseClient();
    if (body.action === "set_agent") await setAdminSalesAgent(admin, {
      adminUserId: user.id, userId: required(body.userId, "Account is required."),
      sponsorAgentId: optional(body.sponsorAgentId), commissionDepthLimit: Number(body.commissionDepthLimit) === 5 ? 5 : 3,
      status: status(body.status),
    });
    else if (body.action === "assign_venue") await assignAdminVenueSalesAgent(admin, {
      adminUserId: user.id, venueId: required(body.venueId, "Venue is required."),
      signingAgentId: required(body.signingAgentId, "Signing agent is required."),
      agreementReference: required(body.agreementReference, "Signed agreement reference is required."),
      effectiveFrom: optional(body.effectiveFrom) || undefined,
    });
    else if (body.action === "verify_nats_agent") await verifyNatsAgentAffiliateLink(admin, user.id,
      required(body.agentId, "Agent is required."), reason(body.reason));
    else if (body.action === "disable_nats_agent") await disableNatsAgentAffiliateLink(admin, user.id,
      required(body.agentId, "Agent is required."), reason(body.reason));
    else if (body.action === "retry_nats_agent_export") await retryFailedNatsAgentCommissionExport(admin, user.id,
      required(body.exportId, "Export is required."), reason(body.reason));
    else if (body.action === "reconcile_nats_agent_export") await reconcileNatsAgentCommissionExport(admin, user.id,
      required(body.exportId, "Export is required."), resolution(body.resolution), reason(body.reason));
    else return NextResponse.json({ ok: false, error: "Unsupported sales agent action." }, { status: 400 });
    return NextResponse.json({ ok: true, program: await getAdminSalesAgentProgram(admin) });
  } catch (error) { return apiError(error, "Unable to update the sales agent program."); }
}

function required(value: unknown, message: string) { if (typeof value !== "string" || !value.trim()) throw new Error(message); return value.trim(); }
function optional(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function reason(value: unknown) { const result = required(value, "An audit note is required."); if (result.length > 500) throw new Error("Audit notes must be 500 characters or fewer."); return result; }
function status(value: unknown): "active" | "suspended" | "terminated" { return value === "suspended" || value === "terminated" ? value : "active"; }
function resolution(value: unknown): "confirmed_exported" | "confirmed_not_exported" {
  if (value === "confirmed_exported" || value === "confirmed_not_exported") return value;
  throw new Error("A valid NATS reconciliation outcome is required.");
}
