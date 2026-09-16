import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function retiredReferralBilling(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    return NextResponse.json({ ok: false, error: "Venue billing is subscription only. Referral invoices and payout controls have been retired.", session: session || null }, { status: 410 });
  } catch (error) {
    return apiError(error, "Unable to verify admin access.");
  }
}

export const GET = retiredReferralBilling;
export const POST = retiredReferralBilling;
