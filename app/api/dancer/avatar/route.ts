import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  isAvatarFaceDetectionUnavailableError,
  isAvatarFaceRequiredError,
} from "@/src/lib/dancr/avatar-face";
import { deleteOwnDancerAvatar } from "@/src/lib/dancr/dancer";
import { moderateAndStoreDancerPhoto } from "@/src/lib/dancr/image-moderation";
import { PROFILE_AVATAR_CONTEXT } from "@/src/lib/dancr/photo-slot";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Avatar image is required." }, { status: 400 });
    }

    const result = await moderateAndStoreDancerPhoto(client, createAdminSupabaseClient(), {
      file,
      userId: user.id,
      isPrimary: false,
      sortOrder: 0,
      replaceExisting: true,
      uploadContext: PROFILE_AVATAR_CONTEXT,
      altText: "Dancer avatar",
      idempotencyKey: request.headers.get("idempotency-key") || parseOptionalText(formData.get("idempotencyKey")),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "",
    });

    const status = result.decision === "rejected" ? 422 : 200;
    return NextResponse.json({ ok: result.decision !== "rejected", ...result }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isAvatarFaceRequiredError(error)) {
      return apiError(error, "Choose a clear face photo for your avatar.", 422);
    }
    if (isAvatarFaceDetectionUnavailableError(error)) {
      return apiError(error, "Avatar face centering is temporarily unavailable.", 503);
    }
    if (message.startsWith("Image moderation ")) {
      return apiError(error, "Unable to upload dancer avatar.", 503);
    }
    return apiError(error, "Unable to upload dancer avatar.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const result = await deleteOwnDancerAvatar(client, user.id, createAdminSupabaseClient());
    return NextResponse.json({ ok: true, avatar: result });
  } catch (error) {
    return apiError(error, "Unable to delete dancer avatar.");
  }
}

function parseOptionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
