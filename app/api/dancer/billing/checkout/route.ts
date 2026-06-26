import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createDancerCheckoutSession } from "@/src/lib/dancr/payments";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const checkout = await createDancerCheckoutSession(client, user);

    return NextResponse.json({ ok: true, ...checkout });
  } catch (error) {
    return apiError(error, "Unable to create Stripe checkout session.");
  }
}
