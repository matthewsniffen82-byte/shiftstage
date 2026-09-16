import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    return NextResponse.json({ ok: false, billingModel: "subscription", error: "Venue subscriptions have no referral fees or per-guest payments." }, { status: 410, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to verify venue access."); }
}
