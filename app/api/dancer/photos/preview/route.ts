import { NextResponse } from "next/server";
import sharp from "sharp";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedFormData } from "@/src/lib/bounded-form-data";
import { MAX_DANCR_RAW_UPLOAD_BYTES, validateAndPrepareDancrImage } from "@/src/lib/dancr/image-validation";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

// A private, transient preview only: no storage objects, media records, or
// moderation decisions are created until the dancer confirms their crop.
export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request, { role: "dancer" });
    await enforcePublicRequestRateLimit(createAdminSupabaseClient(), {
      namespace: "dancer_photo_crop_preview", request, subject: user.id,
      windowSeconds: 3600, subjectLimit: 60, ipLimit: 120,
    });
    const { data: profile, error } = await client.from("dancer_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!profile) return NextResponse.json({ ok: false, error: "Dancer profile required." }, { status: 403, headers: privateHeaders });
    const form = await readBoundedFormData(request, {
      maxBytes: MAX_DANCR_RAW_UPLOAD_BYTES + 64 * 1024,
      invalidMessage: "Invalid photo preview request.",
      tooLargeMessage: "Photo must be 25 MB or smaller.",
    });
    const file = form.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "Photo file is required." }, { status: 400, headers: privateHeaders });
    const image = await validateAndPrepareDancrImage(file).catch(() => {
      throw new PublicApiError("INVALID_REQUEST", "Choose a readable JPEG, PNG, WebP, HEIC, or HEIF photo up to 25 MB.", 400);
    });
    const preview = await sharp(image.buffer)
      .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#000000" })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toBuffer();
    return NextResponse.json({ ok: true, imageDataUrl: `data:image/jpeg;base64,${preview.toString("base64")}`, session }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json({ ok: false, error: "Too many photo previews. Please wait before trying again." }, {
        status: 429, headers: { ...privateHeaders, "retry-after": String(error.retryAfterSeconds) },
      });
    }
    const response = apiError(error, "Unable to prepare this photo. Try another JPEG, PNG, WebP, HEIC, or HEIF image.");
    Object.entries(privateHeaders).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}
