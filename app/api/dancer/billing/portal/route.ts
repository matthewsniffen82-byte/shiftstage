import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createDancerBillingPortalSession } from "@/src/lib/dancr/payments";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const portal = await createDancerBillingPortalSession(client, user.id);

    return NextResponse.json({ ok: true, ...portal });
  } catch (error) {
    return apiError(error, "Unable to create Stripe billing portal session.");
  }
}
