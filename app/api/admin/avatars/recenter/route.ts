import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    authorizeMaintenanceRequest(request);
    const body = await request.json();
    const dancerSlug = cleanSlug(body?.dancerSlug);
    const admin = createAdminSupabaseClient();
    const { data: dancer, error: dancerError } = await admin
      .from("dancer_profiles")
      .select("id, user_id, stage_name, slug, avatar_storage_path")
      .eq("slug", dancerSlug)
      .maybeSingle();
    if (dancerError) throw dancerError;
    if (!dancer?.id || !dancer?.user_id) throw new Error("The requested dancer profile is unavailable.");

    const previousPath = String(dancer.avatar_storage_path || "").trim();
    if (!previousPath || /^https?:\/\//i.test(previousPath)) {
      throw new Error("The requested dancer does not have a stored avatar to recenter.");
    }
    const { data: storedAvatar, error: downloadError } = await admin.storage
      .from(APPROVED_PHOTO_BUCKET)
      .download(previousPath);
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
    console.info(
      JSON.stringify({
        event: "dancer_avatar.platform_recentered",
        dancerId: dancer.id,
        dancerSlug: dancer.slug,
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
    return apiError(error, "Unable to recenter dancer avatar.", 400);
  }
}

function authorizeMaintenanceRequest(request: Request) {
  const expected = process.env.DANCR_MEDIA_IMPORT_KEY || "";
  const provided = request.headers.get("x-mydancr-media-import-key") || "";
  if (expected.length < 32 || provided.length !== expected.length) {
    throw new Error("Avatar maintenance access denied.");
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new Error("Avatar maintenance access denied.");
  }
}

function cleanSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(slug)) {
    throw new Error("Use a valid dancer profile slug.");
  }
  return slug;
}
