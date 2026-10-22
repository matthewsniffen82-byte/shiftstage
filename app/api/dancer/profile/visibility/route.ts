import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { isCoreVerificationApproved } from "@/src/lib/dancr/profile-approval";
import { transitionDancerPublication } from "@/src/lib/dancr/profile-publication";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_VISIBILITY_BODY_BYTES = 2_048;

type VisibilityRequest = { isPublic: boolean } | { isIncognito: boolean };

function json(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("cache-control", "no-store");
  return response;
}

function isVisibilityRequest(value: unknown): value is VisibilityRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && (typeof body.isPublic === "boolean" || typeof body.isIncognito === "boolean");
}

async function verifyPublicVisibility(
  db: ReturnType<typeof createAdminSupabaseClient>,
  dancerId: string,
  isPublic: boolean,
  isIncognito: boolean,
) {
  const { data: profile, error }: any = await db
    .from("dancer_profiles")
    .select("id, status, verification_status, venue_approved_at, disabled_at, is_public, is_incognito")
    .eq("id", dancerId)
    .maybeSingle();

  if (error) throw error;

  const status = String(profile?.status || "").toLowerCase();
  const publicProfileVisible = Boolean(
    profile &&
    profile.is_public === true &&
    !profile.disabled_at &&
    status !== "rejected" &&
    status !== "disabled" &&
    isCoreVerificationApproved(profile),
  );

  if (publicProfileVisible !== isPublic || profile?.is_incognito !== isIncognito) {
    throw new Error("PUBLIC_PROFILE_VISIBILITY_VERIFICATION_FAILED");
  }

  return {
    verified: true,
    isPublic,
    isIncognito,
    publicProfileVisible,
  };
}

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer" });
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_VISIBILITY_BODY_BYTES,
      invalidMessage: "Invalid profile visibility request.",
      tooLargeMessage: "Profile visibility request is too large.",
    });
    if (!isVisibilityRequest(body)) {
      return json({ ok: false, error: "Choose a valid profile visibility." }, 400);
    }

    const db = createAdminSupabaseClient() as any;
    const { data: currentProfile, error: currentProfileError } = await db
      .from("dancer_profiles")
      .select("id, status, verification_status, venue_approved_at, disabled_at, is_public, is_incognito")
      .eq("user_id", user.id)
      .maybeSingle();

    if (currentProfileError) throw currentProfileError;
    if (!currentProfile) {
      return json({ ok: false, error: "Dancer profile not found." }, 404);
    }

    const profileStatus = String(currentProfile.status || "").toLowerCase();
    const coreApprovalComplete = isCoreVerificationApproved(currentProfile);
    const profileBlocked = profileStatus === "rejected" || profileStatus === "disabled";

    const incognito = "isIncognito" in body ? body.isIncognito : !body.isPublic;
    if (!incognito && (!coreApprovalComplete || profileBlocked)) {
      return json({ ok: false, error: "Profile approval is required before reactivation." }, 409);
    }
    if (!incognito && currentProfile.disabled_at) {
      return json({ ok: false, error: "Reactivate your account before making the profile public." }, 409);
    }

    const updatedProfile = await transitionDancerPublication(
      db,
      currentProfile.id,
      incognito ? "set_private" : "restore_visibility",
      { actorUserId: user.id },
    );

    if (updatedProfile.isIncognito !== incognito) {
      throw new Error("PROFILE_VISIBILITY_UPDATE_NOT_APPLIED");
    }
    const visibility = await verifyPublicVisibility(db, currentProfile.id, updatedProfile.isPublic, updatedProfile.isIncognito);

    console.info("DANCER_PROFILE_VISIBILITY_UPDATED", {
      dancerId: updatedProfile.id,
      userId: user.id,
      isPublic: updatedProfile.isPublic,
      publicProfileVisible: visibility.publicProfileVisible,
    });

    return json({
      ok: true,
      changed: true,
      profile: {
        id: updatedProfile.id,
        is_public: updatedProfile.isPublic,
        isPublic: updatedProfile.isPublic,
        is_incognito: updatedProfile.isIncognito,
      },
      visibility,
      session,
    });
  } catch (error: any) {
    if (error instanceof PublicApiError) {
      const response = apiError(error, "Unable to update profile visibility.");
      response.headers.set("cache-control", "no-store");
      return response;
    }
    if (error instanceof Error && error.message === "Sign in required.") {
      return json({ ok: false, error: error.message }, 401);
    }

    const code = String(error?.code || "");
    const message = String(error?.message || "");
    const visibilitySchemaUnavailable =
      (code === "42703" || code === "PGRST204") && message.toLowerCase().includes("is_public");

    console.error("DANCER_PROFILE_VISIBILITY_UPDATE_FAILED", {
      ...safeErrorMetadata(error),
    });

    return json(
      {
        ok: false,
        error: visibilitySchemaUnavailable
          ? "Profile visibility is temporarily unavailable."
          : "Unable to update profile visibility.",
      },
      visibilitySchemaUnavailable ? 503 : 500,
    );
  }
}
