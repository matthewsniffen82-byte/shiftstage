import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  getOwnIdentityVerification,
  startOwnIdentityVerification,
} from "@/src/lib/dancr/identity";
import { getIdentityVerificationMode } from "@/src/lib/dancr/identity-mode";
import { getOptionalServerEnv } from "@/src/lib/env";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const mode = getIdentityVerificationMode();
    if (mode === "auto_approve") {
      return NextResponse.json(
        { ok: true, mode, verification: automaticApprovalResult() },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const verification = await getOwnIdentityVerification(createAdminSupabaseClient(), user.id);
    return NextResponse.json(
      { ok: true, mode, verification },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, "Unable to load identity verification.");
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const mode = getIdentityVerificationMode();
    if (mode === "auto_approve") {
      return NextResponse.json(
        {
          ok: true,
          mode,
          alreadyVerified: true,
          redirectUrl: null,
          verification: automaticApprovalResult(),
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const requestUrl = new URL(request.url);
    const siteUrl = getOptionalServerEnv("NEXT_PUBLIC_SITE_URL") || requestUrl.origin;
    const returnUrl = new URL("/", siteUrl);
    returnUrl.searchParams.set("dancr_dashboard", "dancer");
    returnUrl.searchParams.set("dancr_step", "verification");
    returnUrl.searchParams.set("identity_return", "1");
    const webhookUrl = new URL("/api/verifymycontent/webhook", siteUrl);

    const result = await startOwnIdentityVerification(createAdminSupabaseClient(), {
      userId: user.id,
      returnUrl: returnUrl.toString(),
      webhookUrl: webhookUrl.toString(),
    });

    return NextResponse.json(
      { ok: true, mode, ...result },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, "Unable to start secure identity verification.");
  }
}

function automaticApprovalResult() {
  return {
    provider: null,
    status: "approved",
    verifiedAt: null,
    startedAt: null,
    expiresAt: null,
    lastErrorCode: null,
  };
}
