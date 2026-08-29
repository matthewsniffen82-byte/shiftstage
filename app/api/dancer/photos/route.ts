import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { deleteOwnDancerPhoto } from "@/src/lib/dancr/dancer";
import { moderateAndStoreDancerPhoto } from "@/src/lib/dancr/image-moderation";
import { isDancerIdentityReferenceRequiredError } from "@/src/lib/dancr/media-identity";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_PHOTO_ACTION_BODY_BYTES = 2_048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Photo file is required." }, { status: 400 });
    }

    const result = await moderateAndStoreDancerPhoto(client, createAdminSupabaseClient(), {
      file,
      userId: user.id,
      isPrimary: formData.get("isPrimary") === "true",
      sortOrder: parseOptionalInteger(formData.get("sortOrder")),
      altText: parseOptionalText(formData.get("altText")),
      replaceExisting: formData.get("replaceExisting") === "true",
      uploadContext: formData.get("isPrimary") === "true" ? "profile_main" : "profile_gallery",
      idempotencyKey: request.headers.get("idempotency-key") || parseOptionalText(formData.get("idempotencyKey")),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "",
    });

    const status = result.decision === "rejected" ? 422 : 200;
    return NextResponse.json({ ok: result.decision !== "rejected", ...result, session }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isDancerIdentityReferenceRequiredError(error)) {
      return apiError(error, "Upload an approved avatar before adding profile photos.", 422);
    }
    if (message.startsWith("Image moderation ")) {
      return apiError(error, "Unable to upload dancer photo.", 503);
    }
    return apiError(error, "Unable to upload dancer photo.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_PHOTO_ACTION_BODY_BYTES,
      invalidMessage: "Invalid photo deletion request.",
      tooLargeMessage: "Photo deletion request is too large.",
    });
    const photoId = typeof body?.photoId === "string" ? body.photoId.trim() : "";

    if (!UUID_PATTERN.test(photoId)) {
      return NextResponse.json({ ok: false, error: "Valid photo id is required." }, { status: 400 });
    }

    const photo = await deleteOwnDancerPhoto(client, user.id, photoId, createAdminSupabaseClient());
    return NextResponse.json({ ok: true, photo, session });
  } catch (error) {
    return apiError(error, "Unable to delete dancer photo.");
  }
}

function parseOptionalInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : undefined;
}

function parseOptionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
