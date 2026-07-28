import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  getVenueMyDancrTvVideos,
  updateVenueMyDancrTvVideo,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenue(client, user.id);
    const dashboard = await getVenueMyDancrTvVideos(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, ...dashboard });
  } catch (error) {
    return apiError(error, "Unable to load venue MyDancr TV videos.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenue(client, user.id);
    const body = await request.json();
    const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
    const tagStatus = body?.tagStatus === "confirmed" || body?.tagStatus === "rejected"
      ? body.tagStatus
      : undefined;
    const featured = typeof body?.featured === "boolean" ? body.featured : undefined;
    if (!UUID_PATTERN.test(videoId)) {
      return NextResponse.json({ ok: false, error: "Choose a tagged video." }, { status: 400 });
    }
    const video = await updateVenueMyDancrTvVideo(
      createAdminSupabaseClient(),
      user.id,
      videoId,
      { tagStatus, featured },
    );
    return NextResponse.json({
      ok: true,
      video,
      message: tagStatus === "rejected"
        ? "Venue tag rejected."
        : featured === true
          ? "Video featured on the venue page."
          : featured === false
            ? "Video removed from the featured position."
            : "Venue tag confirmed.",
    });
  } catch (error) {
    return apiError(error, "Unable to update venue MyDancr TV video.", 400);
  }
}

async function requireActiveVenue(client: any, userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "venue" || account.accountState !== "active") {
    throw new Error("Active venue account required.");
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
