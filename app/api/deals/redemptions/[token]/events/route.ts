import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  recordDealRedemptionEvent,
  type DealLifecycleEventType,
} from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  createRequestSupabaseContext,
  getBearerToken,
} from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set<DealLifecycleEventType>([
  "saved",
  "shared",
  "scanner_opened",
]);

type RouteProps = {
  params: Promise<{ token: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) {
      return NextResponse.json({ ok: false, error: "Invalid QR token." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const eventType = typeof body?.eventType === "string"
      ? body.eventType.trim() as DealLifecycleEventType
      : "";
    if (!EVENT_TYPES.has(eventType as DealLifecycleEventType)) {
      return NextResponse.json({ ok: false, error: "Invalid QR event." }, { status: 400 });
    }
    const sessionId = typeof body?.sessionId === "string" && UUID_PATTERN.test(body.sessionId.trim())
      ? body.sessionId.trim()
      : null;

    const admin = createAdminSupabaseClient();
    await enforceEventRateLimit(admin, request, token, eventType);
    const actorUserId = await optionalActiveUserId(request);
    const event = await recordDealRedemptionEvent(
      admin,
      token,
      eventType as DealLifecycleEventType,
      request,
      { actorUserId, sessionId },
    );
    if (!event) {
      return NextResponse.json({ ok: false, error: "Club Deal not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, event });
  } catch (error) {
    return apiError(error, "Unable to record QR activity.", 400);
  }
}

async function optionalActiveUserId(request: Request) {
  if (!getBearerToken(request)) return null;
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const { data, error } = await client
      .from("app_users")
      .select("account_state")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data?.account_state === "active" ? user.id : null;
  } catch {
    return null;
  }
}

async function enforceEventRateLimit(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  request: Request,
  token: string,
  eventType: string,
) {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip");
  if (!ipAddress) return;

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count, error } = await (admin as any)
    .from("qr_redemption_events")
    .select("id, qr_redemptions!inner(redemption_token)", { count: "exact", head: true })
    .eq("qr_redemptions.redemption_token", token)
    .eq("event_type", eventType)
    .eq("ip_address", ipAddress)
    .gte("occurred_at", since);
  if (error) throw error;
  if ((count || 0) >= 12) {
    throw new Error("Too many QR activity requests. Try again in a few minutes.");
  }
}
