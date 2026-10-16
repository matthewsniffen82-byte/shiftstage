import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { saveOwnMainPhotoAvatarCrop } from "@/src/lib/dancr/main-photo-avatar";
import { DancerMediaRateLimitError, enforceDancerMediaRequestRateLimit } from "@/src/lib/dancr/media-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    await enforceDancerMediaRequestRateLimit(admin, { media: "image", request, userId: user.id });
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid avatar crop.", tooLargeMessage: "Avatar crop request is too large." });
    const result = await saveOwnMainPhotoAvatarCrop(admin, user.id, body);
    return NextResponse.json({ ok: true, ...result, session }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DancerMediaRateLimitError) return NextResponse.json({ ok: false, error: "Too many photo changes. Wait before trying again." }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to save your avatar crop.");
  }
}
