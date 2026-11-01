import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createZohoMailbox, processMailboxRetention, zohoMailboxConfig } from "@/src/lib/dancr/zoho-mailbox.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  const started = Date.now();
  try {
    const config = zohoMailboxConfig();
    if (!config) return NextResponse.json({ ok: true, status: "connection_required" }, { headers: { "Cache-Control": "private, no-store" } });
    const db = createAdminSupabaseClient();
    const settings = await db.from("mailbox_retention_settings").select("enabled").eq("singleton", true).single();
    if (settings.error) throw new Error("Mailbox settings unavailable");
    if (!settings.data.enabled) return NextResponse.json({ ok: true, status: "paused" }, { headers: { "Cache-Control": "private, no-store" } });
    const mailbox = await createZohoMailbox(config, fetch, started + 45_000);
    const counts = await processMailboxRetention(db, mailbox, Math.max(0, 45_000 - (Date.now() - started)));
    return NextResponse.json({ ok: counts.failed === 0, ...counts }, { status: counts.failed ? 503 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error(JSON.stringify({ event: "mailbox_retention.failed" }));
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
