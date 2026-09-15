import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { getPickup, pickupRpc } from "@/src/lib/dancr/pickup-server";
import { pickupCommand } from "@/src/lib/dancr/pickup-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ requestId: string }> };
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request, { params }: Params) {
  try {
    const context = await createRequestSupabaseContext(request, { active: true });
    const result = await getPickup(context.client, (await params).requestId, new URL(request.url).searchParams);
    return NextResponse.json({ ok: true, ...result, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to load pickup conversation."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await createRequestSupabaseContext(request, { active: true });
    const body = await readBoundedJsonObject(request, { maxBytes: 12288, invalidMessage: "Invalid pickup action.", tooLargeMessage: "Pickup action is too large." });
    const command = pickupCommand((await params).requestId, body);
    await pickupRpc(context.client, command.name, command.args);
    return NextResponse.json({ ok: true, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to update pickup conversation."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
