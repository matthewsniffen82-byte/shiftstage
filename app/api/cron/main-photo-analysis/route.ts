import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { processMainPhotoHairColors } from "@/src/lib/dancr/hair-color-worker";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await processMainPhotoHairColors(createAdminSupabaseClient());
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 500 : 200 });
  } catch (error) {
    console.error("MAIN_PHOTO_ANALYSIS_WORKER_FAILED", safeErrorMetadata(error));
    return NextResponse.json({ ok: false, error: "Main-photo analysis unavailable." }, { status: 500 });
  }
}
