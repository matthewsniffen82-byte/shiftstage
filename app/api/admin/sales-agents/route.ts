import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
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
const MAX_SALES_AGENT_ADMIN_BODY_BYTES = 8_192;

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request); await requireAdmin(client, user.id);
    return NextResponse.json({ ok: true, program: await getAdminSalesAgentProgram(createAdminSupabaseClient()), session: session || null },
      { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load the sales agent program."); }
}

export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request); await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_SALES_AGENT_ADMIN_BODY_BYTES,
      invalidMessage: "Invalid sales agent admin request.",
      tooLargeMessage: "Sales agent admin request is too large.",
    }); const admin = createAdminSupabaseClient();
    if (body.action === "set_agent") await setAdminSalesAgent(admin, {
      adminUserId: user.id, userId: required(body.userId, "Account is required."),
      sponsorAgentId: optional(body.sponsorAgentId), commissionDepthLimit: commissionDepth(body.commissionDepthLimit),
      status: status(body.status),
    });
    else if (body.action === "assign_venue") await assignAdminVenueSalesAgent(admin, {
      adminUserId: user.id, venueId: required(body.venueId, "Venue is required."),
      signingAgentId: required(body.signingAgentId, "Signing agent is required."),
      agreementReference: required(body.agreementReference, "Signed agreement reference is required."),
      effectiveFrom: effectiveTime(body.effectiveFrom),
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
    return NextResponse.json({ ok: true, program: await getAdminSalesAgentProgram(admin), session: session || null });
  } catch (error) { return apiError(error, "Unable to update the sales agent program."); }
}

function required(value: unknown, message: string) { if (typeof value !== "string" || !value.trim()) throw new PublicApiError("INVALID_REQUEST", message, 400); return value.trim(); }
function optional(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new PublicApiError("INVALID_REQUEST", "Optional sales agent values must be text.", 400);
  return value.trim() || null;
}
function reason(value: unknown) { const result = required(value, "An audit note is required."); if (result.length > 500) throw new PublicApiError("INVALID_REQUEST", "Audit notes must be 500 characters or fewer.", 400); return result; }
function status(value: unknown): "active" | "suspended" | "terminated" {
  if (value === "active" || value === "suspended" || value === "terminated") return value;
  throw new PublicApiError("INVALID_REQUEST", "Choose a valid sales agent status.", 400);
}
function commissionDepth(value: unknown): 3 | 5 {
  if (value === 3 || value === "3") return 3;
  if (value === 5 || value === "5") return 5;
  throw new PublicApiError("INVALID_REQUEST", "Agent depth must be three or five levels.", 400);
}
function resolution(value: unknown): "confirmed_exported" | "confirmed_not_exported" {
  if (value === "confirmed_exported" || value === "confirmed_not_exported") return value;
  throw new PublicApiError("INVALID_REQUEST", "Choose a valid commission review outcome.", 400);
}

function effectiveTime(value: unknown): string | undefined {
  const text = optional(value);
  if (!text) return undefined;
  const absoluteTime = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/;
  if (!absoluteTime.test(text) || text.startsWith("0000-") || !Number.isFinite(Date.parse(text))
    || new Date(text.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !== text.slice(0, 10)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a valid effective date and time with a timezone.", 400);
  }
  // Preserve PostgreSQL microseconds and the caller's explicit offset.
  return text;
}
