import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { pickupAccountRole } from "@/src/lib/dancr/pickup-server";
import { listPhonePickupRequests } from "@/src/lib/dancr/pickup-phone-requests";
import { pickupChatRetired } from "@/src/lib/dancr/pickup-retired";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { active: true });
    const role = await pickupAccountRole(context.client);
    const result = role === "customer" ? { phoneRequests: [], hasMorePhoneRequests: false }
      : await listPhonePickupRequests(context.client, new URL(request.url).searchParams);
    return NextResponse.json({ ok: true, role, ...result, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to load pickup requests."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
export const POST = pickupChatRetired;
