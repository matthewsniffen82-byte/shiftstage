import { NextResponse } from "next/server";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { isCoreVerificationApproved } from "@/src/lib/dancr/profile-approval";
import { transitionDancerPublication } from "@/src/lib/dancr/profile-publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VisibilityRequest = {
  isPublic: boolean;
};

function json(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("cache-control", "no-store");
  return response;
}

function isVisibilityRequest(value: unknown): value is VisibilityRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && typeof body.isPublic === "boolean";
}

async function verifyPublicVisibility(
  db: ReturnType<typeof createAdminSupabaseClient>,
  dancerId: string,
  isPublic: boolean,
) {
  const { data: profile, error }: any = await db
    .from("dancer_profiles")
    .select("id, status, verification_status, venue_approved_at, disabled_at, is_public")
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

  if (publicProfileVisible !== isPublic) {
    throw new Error("PUBLIC_PROFILE_VISIBILITY_VERIFICATION_FAILED");
  }

  return {
    verified: true,
    isPublic,
    publicProfileVisible,
  };
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!isVisibilityRequest(body)) {
      return json({ ok: false, error: "isPublic must be a boolean." }, 400);
    }

    const { user, session } = await createRequestSupabaseContext(request);
    const db = createAdminSupabaseClient() as any;
    const { data: currentProfile, error: currentProfileError } = await db
      .from("dancer_profiles")
      .select("id, status, verification_status, venue_approved_at, disabled_at, is_public")
      .eq("user_id", user.id)
      .maybeSingle();

    if (currentProfileError) throw currentProfileError;
    if (!currentProfile) {
      return json({ ok: false, error: "Dancer profile not found." }, 404);
    }

    const profileStatus = String(currentProfile.status || "").toLowerCase();
    const coreApprovalComplete = isCoreVerificationApproved(currentProfile);
    const profileBlocked = profileStatus === "rejected" || profileStatus === "disabled";

    if (body.isPublic && (!coreApprovalComplete || profileBlocked)) {
      return json({ ok: false, error: "Profile approval is required before reactivation." }, 409);
    }
    if (body.isPublic && currentProfile.disabled_at) {
      return json({ ok: false, error: "Reactivate your account before making the profile public." }, 409);
    }

    if (currentProfile.is_public === body.isPublic) {
      const visibility = await verifyPublicVisibility(db, currentProfile.id, body.isPublic);
      return json({
        ok: true,
        changed: false,
        profile: {
          id: currentProfile.id,
          is_public: currentProfile.is_public,
          isPublic: currentProfile.is_public,
        },
        visibility,
        session,
      });
    }

    const updatedProfile = await transitionDancerPublication(
      db,
      currentProfile.id,
      body.isPublic ? "set_public" : "set_private",
      { actorUserId: user.id },
    );

    if (updatedProfile.isPublic !== body.isPublic) {
      throw new Error("PROFILE_VISIBILITY_UPDATE_NOT_APPLIED");
    }
    const visibility = await verifyPublicVisibility(db, currentProfile.id, body.isPublic);

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
      },
      visibility,
      session,
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === "Sign in required.") {
      return json({ ok: false, error: error.message }, 401);
    }

    const code = String(error?.code || "");
    const message = String(error?.message || "");
    const visibilitySchemaUnavailable =
      (code === "42703" || code === "PGRST204") && message.toLowerCase().includes("is_public");

    console.error("DANCER_PROFILE_VISIBILITY_UPDATE_FAILED", {
      code: code || null,
      message: message || "Unknown profile visibility error.",
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
