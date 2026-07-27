import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  deleteAdminDancerSocialLink,
  getAdminDancerDetail,
  requireAdmin,
} from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string; socialId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id, socialId } = await context.params;
    if (!UUID_PATTERN.test(id || "") || !UUID_PATTERN.test(socialId || "")) {
      return NextResponse.json({ ok: false, error: "Invalid dancer or social-link ID." }, { status: 400 });
    }

    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const admin = createAdminSupabaseClient();
    const deleted = await deleteAdminDancerSocialLink(admin, {
      dancerId: id,
      targetId: socialId,
      adminId: user.id,
    });
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Dancer social link not found." }, { status: 404 });
    }

    const profile = await getAdminDancerDetail(admin, id);
    return NextResponse.json({ ok: true, deleted, profile });
  } catch (error) {
    return apiError(error, "Unable to delete dancer social link.");
  }
}
