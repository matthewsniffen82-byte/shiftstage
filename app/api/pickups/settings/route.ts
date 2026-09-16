import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { pickupAccountRole, pickupRpc } from "@/src/lib/dancr/pickup-server";
import { pickupChatRetired } from "@/src/lib/dancr/pickup-retired";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { active: true });
    const role = await pickupAccountRole(context.client);
    const manageable = role === "customer" ? [] : await pickupRpc(context.client, "pickup_manageable_venues");
    const venues = manageable.map(({ id, name, slug }: { id: string; name: string; slug: string }) => ({ id, name, slug }));
    return NextResponse.json({ ok: true, venues, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to load pickup venues."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
export const POST = pickupChatRetired;
