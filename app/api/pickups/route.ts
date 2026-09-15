import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { listPickups, pickupRpc } from "@/src/lib/dancr/pickup-server";
import { pickupCreateArgs } from "@/src/lib/dancr/pickup-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { active: true });
    const result = await listPickups(context.client, new URL(request.url).searchParams);
    return NextResponse.json({ ok: true, ...result, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to load pickup requests."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
export async function POST(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { role: "customer" });
    const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid pickup request.", tooLargeMessage: "Pickup request is too large." });
    const id = await pickupRpc(context.client, "pickup_create_request", pickupCreateArgs(body));
    return NextResponse.json({ ok: true, id, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to create pickup request."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
