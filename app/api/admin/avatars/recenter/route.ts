import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  isAvatarFaceDetectionUnavailableError,
  isAvatarFaceRequiredError,
  prepareFaceCenteredAvatar,
} from "@/src/lib/dancr/avatar-face";
import { validateAndPrepareDancrImage } from "@/src/lib/dancr/image-validation";
import {
  APPROVED_PHOTO_BUCKET,
  restoreDancerAvatar,
  setApprovedDancerAvatar,
} from "@/src/lib/dancr/image-moderation";
import {
  removeResponsiveImage,
  responsivePublicImage,
  uploadResponsiveImage,
} from "@/src/lib/dancr/responsive-image";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { getOptionalServerEnv } from "@/src/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RECENTER_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    authorizeMaintenanceRequest(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_RECENTER_BODY_BYTES,
      invalidMessage: "Invalid avatar maintenance request.",
      tooLargeMessage: "Avatar maintenance request is too large.",
    });
    const dancerSlug = cleanSlug(body?.dancerSlug);
    const admin = createAdminSupabaseClient();
    const { data: dancer, error: dancerError } = await admin
      .from("dancer_profiles")
      .select("id, user_id, stage_name, slug, avatar_storage_path")
      .eq("slug", dancerSlug)
      .maybeSingle();
    if (dancerError) throw dancerError;
    if (!dancer?.id || !dancer?.user_id) {
      throw new PublicApiError("NOT_FOUND", "The requested dancer profile is unavailable.", 404);
    }

    const previousPath = String(dancer.avatar_storage_path || "").trim();
    if (!previousPath || /^https?:\/\//i.test(previousPath)) {
      throw new PublicApiError(
        "CONFLICT",
        "The requested dancer does not have a stored avatar to recenter.",
        409,
      );
    }
    const { data: sourcePhoto, error: sourcePhotoError } = await admin
      .from("dancer_photos")
      .select("storage_path")
      .eq("dancer_id", dancer.id)
      .eq("review_status", "approved")
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sourcePhotoError) throw sourcePhotoError;
    const sourcePath = String(sourcePhoto?.storage_path || previousPath).trim();
    const { data: storedAvatar, error: downloadError } = await admin.storage
      .from(APPROVED_PHOTO_BUCKET)
      .download(sourcePath);
    if (downloadError || !storedAvatar) {
      throw downloadError || new Error("The current avatar could not be downloaded.");
    }

    const sourceImage = await validateAndPrepareDancrImage(storedAvatar);
    const centeredAvatar = await prepareFaceCenteredAvatar(sourceImage);
    const uploaded = await uploadResponsiveImage(
      admin,
      APPROVED_PHOTO_BUCKET,
      `${dancer.user_id}/${dancer.id}/avatar`,
      centeredAvatar,
    );
    let switched = false;
    try {
      const actualPreviousPath = await setApprovedDancerAvatar(
        admin,
        dancer.id,
        uploaded.storagePath,
      );
      switched = true;
      if (actualPreviousPath && actualPreviousPath !== uploaded.storagePath) {
        await removeResponsiveImage(admin, APPROVED_PHOTO_BUCKET, actualPreviousPath).catch(
          () => null,
        );
      }
    } catch (error) {
      if (switched) await restoreDancerAvatar(admin, dancer.id, previousPath).catch(() => null);
      await removeResponsiveImage(
        admin,
        APPROVED_PHOTO_BUCKET,
        uploaded.storagePath,
      ).catch(() => null);
      throw error;
    }

    const publicAvatar = responsivePublicImage(
      admin,
      APPROVED_PHOTO_BUCKET,
      uploaded.storagePath,
    );
    const { error: auditError } = await admin.from("admin_actions").insert({
      admin_id: user.id,
      target_type: "dancer_profile",
      target_id: dancer.id,
      action: "recenter_dancer_avatar",
      notes: `Source: ${sourcePath === previousPath ? "avatar" : "approved photo"}`,
    });
    if (auditError) throw auditError;
    console.info(
      JSON.stringify({
        event: "dancer_avatar.platform_recentered",
        adminId: user.id,
        dancerId: dancer.id,
        dancerSlug: dancer.slug,
        sourceKind: sourcePath === previousPath ? "avatar" : "approved_photo",
        sourceWidth: sourceImage.width,
        sourceHeight: sourceImage.height,
        outputWidth: uploaded.width,
        outputHeight: uploaded.height,
      }),
    );

    return NextResponse.json(
      {
        ok: true,
        dancer: { id: dancer.id, slug: dancer.slug, stageName: dancer.stage_name },
        avatar: {
          imageUrl: publicAvatar?.imageUrl || "",
          masterImageUrl: publicAvatar?.masterImageUrl || "",
          focalX: uploaded.focalX,
          focalY: uploaded.focalY,
          height: uploaded.height,
          width: uploaded.width,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isAvatarFaceRequiredError(error)) {
      return apiError(error, "The stored avatar does not contain a clear face.", 422);
    }
    if (isAvatarFaceDetectionUnavailableError(error)) {
      return apiError(error, "Avatar face centering is temporarily unavailable.", 503);
    }
    return apiError(error, "Unable to recenter dancer avatar.");
  }
}

function authorizeMaintenanceRequest(request: Request) {
  const expected = getOptionalServerEnv("DANCR_MEDIA_IMPORT_KEY") || "";
  const provided = request.headers.get("x-mydancr-media-import-key") || "";
  if (expected.length < 32 || provided.length !== expected.length) {
    throw forbidden("Avatar maintenance access denied.");
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw forbidden("Avatar maintenance access denied.");
  }
}

function cleanSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(slug)) {
    throw invalid("Use a valid dancer profile slug.");
  }
  return slug;
}

function invalid(message: string, status = 400) {
  return new PublicApiError("INVALID_REQUEST", message, status);
}

function forbidden(message: string) {
  return new PublicApiError("FORBIDDEN", message, 403);
}
