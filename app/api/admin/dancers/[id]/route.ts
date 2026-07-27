import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  deleteAdminDancerProfile,
  getAdminDancerDetail,
  requireAdmin,
} from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const dancerId = await readDancerId(context);
    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Invalid dancer profile ID." }, { status: 400 });
    }

    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const profile = await getAdminDancerDetail(createAdminSupabaseClient(), dancerId);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return apiError(error, "Unable to load dancer profile.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const dancerId = await readDancerId(context);
    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Invalid dancer profile ID." }, { status: 400 });
    }

    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const deleted = await deleteAdminDancerProfile(createAdminSupabaseClient(), {
      dancerId,
      adminId: user.id,
    });
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return apiError(error, "Unable to delete dancer profile.");
  }
}

async function readDancerId(context: RouteContext) {
  const { id } = await context.params;
  const dancerId = typeof id === "string" ? id.trim() : "";
  return UUID_PATTERN.test(dancerId) ? dancerId : null;
}
