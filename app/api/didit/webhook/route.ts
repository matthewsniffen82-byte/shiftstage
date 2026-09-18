import { NextResponse } from "next/server";
import { readBoundedRequestBytes } from "@/src/lib/bounded-json-body";
import { diditConfig, reconcileDiditSession } from "@/src/lib/dancr/didit";
import { isDiditSessionId, verifyDiditWebhook } from "@/src/lib/dancr/didit-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const config = diditConfig();
  if (!config) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedRequestBytes(request, 1_048_576, "Webhook too large.", 10_000));
    const event = verifyDiditWebhook(raw, request.headers, config.webhookSecret);
    if (!event) return NextResponse.json({ ok: false }, { status: 401 });
    if (event.environment === "sandbox" || event.sandbox_scenario) return NextResponse.json({ ok: true });
    if (event.webhook_type === "status.updated" && isDiditSessionId(event.session_id)) {
      // Re-fetch the authoritative decision; webhook arrival order is not authority.
      await reconcileDiditSession(createAdminSupabaseClient(), event.session_id);
    }
    return NextResponse.json({ ok: true });
  } catch {
    // No payload, ID details, secret, or provider error is written to application logs.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
