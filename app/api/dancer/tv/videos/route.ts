import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  createMyDancrTvUpload,
  getDancerMyDancrTvWorkspace,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const workspace = await getDancerMyDancrTvWorkspace(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, ...workspace });
  } catch (error) {
    return apiError(error, "Unable to load your MyDancr TV videos.");
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const upload = await createMyDancrTvUpload(createAdminSupabaseClient(), user.id, {
      mimeType: typeof body?.mimeType === "string" ? body.mimeType : "",
      fileSize: Number(body?.fileSize),
      durationSeconds: Number(body?.durationSeconds),
      width: Number(body?.width),
      height: Number(body?.height),
      consentConfirmed: body?.consentConfirmed === true,
      rightsConfirmed: body?.rightsConfirmed === true,
    });
    return NextResponse.json({ ok: true, upload }, { status: 201 });
  } catch (error) {
    return apiError(error, "Unable to prepare your MyDancr TV upload.", 400);
  }
}
