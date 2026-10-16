import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { cleanExpiredPhotoUploads } from "@/src/lib/dancr/photo-upload-reservation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({ ok: true, removed: await cleanExpiredPhotoUploads(createAdminSupabaseClient()) });
  } catch (error) {
    console.error(JSON.stringify({ event: "photo_upload.cleanup_failed", ...safeErrorMetadata(error) }));
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
