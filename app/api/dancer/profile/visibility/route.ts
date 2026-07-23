import { NextResponse } from "next/server";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

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

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!isVisibilityRequest(body)) {
      return json({ ok: false, error: "isPublic must be a boolean." }, 400);
    }

    const { client, user } = await createRequestSupabaseContext(request);
    const db = client as any;
    const { data: currentProfile, error: currentProfileError } = await db
      .from("dancer_profiles")
      .select("id, status, disabled_at, is_public")
      .eq("user_id", user.id)
      .maybeSingle();

    if (currentProfileError) throw currentProfileError;
    if (!currentProfile) {
      return json({ ok: false, error: "Dancer profile not found." }, 404);
    }

    if (body.isPublic && String(currentProfile.status || "").toLowerCase() !== "approved") {
      return json({ ok: false, error: "Profile approval is required before reactivation." }, 409);
    }
    if (body.isPublic && currentProfile.disabled_at) {
      return json({ ok: false, error: "Reactivate your account before making the profile public." }, 409);
    }

    if (currentProfile.is_public === body.isPublic) {
      return json({
        ok: true,
        changed: false,
        profile: {
          id: currentProfile.id,
          is_public: currentProfile.is_public,
          isPublic: currentProfile.is_public,
        },
      });
    }

    const { data: updatedProfile, error: updateError } = await db
      .from("dancer_profiles")
      .update({ is_public: body.isPublic })
      .eq("id", currentProfile.id)
      .eq("user_id", user.id)
      .select("id, is_public")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedProfile || updatedProfile.is_public !== body.isPublic) {
      throw new Error("PROFILE_VISIBILITY_UPDATE_NOT_APPLIED");
    }

    console.info("DANCER_PROFILE_VISIBILITY_UPDATED", {
      dancerId: updatedProfile.id,
      userId: user.id,
      isPublic: updatedProfile.is_public,
    });

    return json({
      ok: true,
      changed: true,
      profile: {
        id: updatedProfile.id,
        is_public: updatedProfile.is_public,
        isPublic: updatedProfile.is_public,
      },
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
