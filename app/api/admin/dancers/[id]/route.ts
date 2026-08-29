import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  deleteAdminDancerProfile,
  getAdminDancerDetail,
  requireAdmin,
} from "@/src/lib/dancr/admin";
import {
  getAdminDancerOperationalDetail,
  updateAdminDancerLifecycle,
} from "@/src/lib/dancr/admin-dancers";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DANCER_LIFECYCLE_BODY_BYTES = 4_096;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const dancerId = await readDancerId(context);
    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Invalid dancer profile ID." }, { status: 400 });
    }

    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const admin = createAdminSupabaseClient();
    const [profile, operations] = await Promise.all([
      getAdminDancerDetail(admin, dancerId),
      getAdminDancerOperationalDetail(admin, dancerId),
    ]);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, profile: { ...profile, operations }, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load dancer profile.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const dancerId = await readDancerId(context);
    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Invalid dancer profile ID." }, { status: 400 });
    }
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_DANCER_LIFECYCLE_BODY_BYTES,
      invalidMessage: "Invalid dancer lifecycle request.",
      tooLargeMessage: "Dancer lifecycle request is too large.",
    });
    const action = body?.action === "disable" || body?.action === "reactivate" ? body.action : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!action) {
      return NextResponse.json({ ok: false, error: "Action must be disable or reactivate." }, { status: 400 });
    }
    const lifecycle = await updateAdminDancerLifecycle(createAdminSupabaseClient(), {
      dancerId,
      adminId: user.id,
      action,
      reason,
    });
    const admin = createAdminSupabaseClient();
    const [profile, operations] = await Promise.all([
      getAdminDancerDetail(admin, dancerId),
      getAdminDancerOperationalDetail(admin, dancerId),
    ]);
    return NextResponse.json({ ok: true, lifecycle, profile: profile ? { ...profile, operations } : null, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to update dancer lifecycle.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const dancerId = await readDancerId(context);
    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Invalid dancer profile ID." }, { status: 400 });
    }

    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const deleted = await deleteAdminDancerProfile(createAdminSupabaseClient(), {
      dancerId,
      adminId: user.id,
    });
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deleted, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to delete dancer profile.");
  }
}

async function readDancerId(context: RouteContext) {
  const { id } = await context.params;
  const dancerId = typeof id === "string" ? id.trim() : "";
  return UUID_PATTERN.test(dancerId) ? dancerId : null;
}
