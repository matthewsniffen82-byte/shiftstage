import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { privacyIntake } from "@/src/lib/dancr/public-case-intake";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 16_384, invalidMessage: "Invalid privacy request.", tooLargeMessage: "Privacy request is too large." });
    const intake = privacyIntake(body);
    const client = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(client, { namespace: "privacy_request", request, subject: intake.contactEmail, windowSeconds: 600, ipLimit: 8, subjectLimit: 3 });
    const { data, error } = await (client as any).from("content_reports").insert({
      target_type: "contact_message", target_label: "Privacy request", reason: intake.right,
      details: intake.details, case_kind: "privacy", intake, status: "open", priority: "normal",
    }).select("id,created_at").single();
    if (error) throw error;
    // Intake never performs a disclosure/deletion or confirms account existence.
    return NextResponse.json({ ok: true, reference: data.id, receivedAt: data.created_at }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Too many requests. Please wait and try again." }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to submit privacy request.");
  }
}
