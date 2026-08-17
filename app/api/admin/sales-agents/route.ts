import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  assignAdminVenueSalesAgent,
  getAdminSalesAgentProgram,
  recordAdminAgentCommissionPayment,
  setAdminSalesAgent,
} from "@/src/lib/dancr/sales-agents";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    return NextResponse.json({
      ok: true,
      program: await getAdminSalesAgentProgram(createAdminSupabaseClient()),
    });
  } catch (error) {
    return apiError(error, "Unable to load the sales agent program.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();

    if (body.action === "set_agent") {
      await setAdminSalesAgent(admin, {
        adminUserId: user.id,
        userId: requiredText(body.userId, "Account is required."),
        sponsorAgentId: optionalText(body.sponsorAgentId),
        commissionDepthLimit: Number(body.commissionDepthLimit) === 5 ? 5 : 3,
        status: allowedStatus(body.status),
      });
    } else if (body.action === "assign_venue") {
      await assignAdminVenueSalesAgent(admin, {
        adminUserId: user.id,
        venueId: requiredText(body.venueId, "Venue is required."),
        signingAgentId: requiredText(body.signingAgentId, "Signing agent is required."),
        agreementReference: requiredText(body.agreementReference, "Signed venue agreement reference is required."),
        effectiveFrom: optionalText(body.effectiveFrom) || undefined,
      });
    } else if (body.action === "record_payment") {
      await recordAdminAgentCommissionPayment(admin, {
        adminUserId: user.id,
        commissionEventId: requiredText(body.commissionEventId, "Commission is required."),
        payoutReference: requiredText(body.payoutReference, "Payout reference is required."),
      });
    } else {
      return NextResponse.json({ ok: false, error: "Unsupported sales agent action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, program: await getAdminSalesAgentProgram(admin) });
  } catch (error) {
    return apiError(error, "Unable to update the sales agent program.");
  }
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function allowedStatus(value: unknown): "active" | "suspended" | "terminated" {
  if (value === "suspended" || value === "terminated") return value;
  return "active";
}
