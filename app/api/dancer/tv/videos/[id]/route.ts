import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  hideOwnMyDancrTvVideo,
  submitMyDancrTvUpload,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid MyDancr TV video." }, { status: 400 });
    }
    const { user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    if (body?.action !== "submit") {
      return NextResponse.json({ ok: false, error: "Invalid video action." }, { status: 400 });
    }
    const video = await submitMyDancrTvUpload(createAdminSupabaseClient(), user.id, id);
    return NextResponse.json({
      ok: true,
      video,
      message: "Your video was submitted for MyDancr TV review.",
    });
  } catch (error) {
    return apiError(error, "Unable to submit your MyDancr TV video.", 400);
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid MyDancr TV video." }, { status: 400 });
    }
    const { user } = await createRequestSupabaseContext(request);
    const video = await hideOwnMyDancrTvVideo(createAdminSupabaseClient(), user.id, id);
    return NextResponse.json({ ok: true, video, message: "Video removed from MyDancr TV." });
  } catch (error) {
    return apiError(error, "Unable to remove your MyDancr TV video.", 400);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
