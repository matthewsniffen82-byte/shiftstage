import { after, NextResponse } from "next/server";
import { deliverPickupPush } from "@/src/lib/dancr/pickup-push-delivery";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { getPickup, pickupRpc } from "@/src/lib/dancr/pickup-server";
import { pickupCommand } from "@/src/lib/dancr/pickup-validation";
import { getGuestPickup, commandGuestPickup } from "@/src/lib/dancr/pickup-guest-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ requestId: string }> };
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request, { params }: Params) {
  try {
    if (!request.headers.has("authorization")) {
      const result = await getGuestPickup(request, (await params).requestId);
      return NextResponse.json({ ok: true, ...result }, { headers });
    }
    const context = await createRequestSupabaseContext(request, { active: true });
    const result = await getPickup(context.client, (await params).requestId, new URL(request.url).searchParams);
    return NextResponse.json({ ok: true, ...result, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to load pickup conversation."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
export async function POST(request: Request, { params }: Params) {
  try {
    if (!request.headers.has("authorization")) {
      const body = await readBoundedJsonObject(request, { maxBytes: 12288, invalidMessage: "Invalid pickup action.", tooLargeMessage: "Pickup action is too large." });
      const requestId = (await params).requestId;
      const notificationSince = new Date(Date.now() - 1000).toISOString();
      await commandGuestPickup(request, requestId, body);
      if (body.action === "message" || body.action === "status") after(() => deliverPickupPush(requestId, notificationSince));
      return NextResponse.json({ ok: true }, { headers });
    }
    const context = await createRequestSupabaseContext(request, { active: true });
    const body = await readBoundedJsonObject(request, { maxBytes: 12288, invalidMessage: "Invalid pickup action.", tooLargeMessage: "Pickup action is too large." });
    const command = pickupCommand((await params).requestId, body);
    const notificationSince = new Date(Date.now() - 1000).toISOString();
    await pickupRpc(context.client, command.name, command.args);
    if (body.action === "message" || body.action === "status") {
      after(() => deliverPickupPush(String(command.args.p_id), notificationSince));
    }
    return NextResponse.json({ ok: true, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to update pickup conversation."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
