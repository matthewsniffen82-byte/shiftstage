import { NextResponse } from "next/server";
import { readBoundedRequestBytes } from "@/src/lib/bounded-json-body";
import { veriffConfig, reconcileVeriffSession } from "@/src/lib/dancr/veriff";
import { isVeriffId, jsonObject, verifyVeriffPayload } from "@/src/lib/dancr/veriff-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const config = veriffConfig();
  if (!config) return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedRequestBytes(request, 1_048_576, "Webhook too large.", 3_000));
    const event = verifyVeriffPayload(raw, request.headers, config);
    if (!event) return NextResponse.json({ ok: false }, { status: 401 });
    const sessionId = jsonObject(event.verification).id;
    if (event.status === "success" && isVeriffId(sessionId)) {
      // A replayed or delayed webhook cannot restore an old approval. Fetch the
      // current signed decision; failures return non-200 so Veriff retries.
      await reconcileVeriffSession(createAdminSupabaseClient(), sessionId, 3_000);
    }
    return NextResponse.json({ ok: true });
  } catch {
    // Never log provider payloads, documents, DOBs, biometric data or secrets.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
