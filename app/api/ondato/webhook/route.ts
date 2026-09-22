import { NextResponse } from "next/server";
import { readBoundedRequestBytes } from "@/src/lib/bounded-json-body";
import { ondatoConfig, reconcileOndatoSession } from "@/src/lib/dancr/ondato";
import { jsonObject, verifyOndatoPayload } from "@/src/lib/dancr/ondato-policy";
import { isOndatoId } from "@/src/lib/dancr/ondato-url";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const config = ondatoConfig();
  if (!config) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedRequestBytes(request, 1_048_576, "Webhook too large.", 3_000));
    const event = verifyOndatoPayload(raw, request.headers, config);
    if (!event) return NextResponse.json({ ok: false }, { status: 401 });
    const payload = jsonObject(event.payload);
    const sessionId = event.type === "IdentityVerification.StatusChanged" ? payload.id
      : ["KycIdentification.Processed", "KycIdentification.Approved", "KycIdentification.Rejected", "KycIdentification.Updated"].includes(String(event.type))
        ? payload.identityVerificationId : null;
    if (isOndatoId(sessionId)) {
      // Notifications only trigger a fresh authenticated retrieval. Browser
      // callbacks and stale webhook payloads never grant approval themselves.
      await reconcileOndatoSession(createAdminSupabaseClient(), sessionId, 18_000);
    }
    return NextResponse.json({ ok: true });
  } catch {
    // Never log provider payloads, documents, DOBs, biometric data or secrets.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
