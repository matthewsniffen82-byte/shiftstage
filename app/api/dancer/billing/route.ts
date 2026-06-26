import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getDancerBillingStatus } from "@/src/lib/dancr/payments";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const billing = await getDancerBillingStatus(client, user.id);

    return NextResponse.json({ ok: true, billing });
  } catch (error) {
    return apiError(error, "Unable to load dancer billing status.");
  }
}
