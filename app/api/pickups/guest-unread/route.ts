import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { guestPickupUnreadCount } from "@/src/lib/dancr/pickup-guest-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

// POST keeps private guest links out of URLs and shared HTTP caches. Read-only.
export async function POST(request: Request) {
  try {
    if (request.headers.has("authorization")) throw new PublicApiError("AUTH_REQUIRED", "Use your saved guest pickup links.", 401);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 12288, invalidMessage: "Invalid saved pickup chats.", tooLargeMessage: "Too many saved pickup chats.",
    });
    const unreadCount = await guestPickupUnreadCount(body);
    return NextResponse.json({ ok: true, unreadCount }, { headers });
  } catch (error) {
    const response = apiError(error, "Unable to check pickup messages.");
    response.headers.set("cache-control", headers["cache-control"]);
    return response;
  }
}
