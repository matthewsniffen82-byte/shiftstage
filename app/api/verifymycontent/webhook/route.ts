import { NextResponse } from "next/server";
import { syncVerifyMyContentIdentityVerification } from "@/src/lib/dancr/identity";
import { getIdentityVerificationMode } from "@/src/lib/dancr/identity-mode";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  parseVerifyMyContentWebhook,
  verifyVerifyMyContentWebhook,
} from "@/src/lib/verifymycontent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (getIdentityVerificationMode() !== "verifymy") {
    return NextResponse.json(
      { ok: false, error: "VerifyMy identity verification is not active." },
      { status: 409 },
    );
  }
  const rawBody = await request.text();

  try {
    verifyVerifyMyContentWebhook(rawBody, request.headers.get("authorization"));
  } catch (error) {
    console.warn("VERIFYMYCONTENT_WEBHOOK_AUTH_REJECTED", {
      message: error instanceof Error ? error.message : "Invalid webhook authorization.",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid VerifyMyContent webhook.",
      },
      { status: 401 },
    );
  }

  try {
    const verification = parseVerifyMyContentWebhook(rawBody);
    await syncVerifyMyContentIdentityVerification(createAdminSupabaseClient(), verification);
    return NextResponse.json({ ok: true, received: true });
  } catch (error) {
    console.error("VERIFYMYCONTENT_WEBHOOK_PROCESSING_FAILED", {
      message: error instanceof Error ? error.message : "Unknown webhook processing error.",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Unable to process VerifyMyContent webhook.",
      },
      { status: 500 },
    );
  }
}
