import type { Metadata } from "next";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import { resolveMyDancrCity } from "@/src/lib/dancr/markets";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import TvFeedClient from "./TvFeedClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MyDancr TV | mydancr",
  description: "Watch approved dancer videos and connect them to real shifts and venues.",
};

type PageProps = {
  searchParams: Promise<{ city?: string; dancer?: string; filter?: string; video?: string }>;
};

export default async function MyDancrTvPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const city = resolveMyDancrCity(params.city);
  const dancerId = cleanUuid(params.dancer);
  const filter = params.filter === "following" || params.filter === "tonight"
    ? params.filter
    : "for-you";
  const initialVideos = filter === "following"
    ? []
    : await getPublicMyDancrTvFeed(createAdminSupabaseClient(), {
        city,
        dancerId,
        filter,
        selectedVideoId: params.video,
        limit: 12,
      });

  return (
    <TvFeedClient
      initialCity={city}
      initialDancerId={dancerId || ""}
      initialFilter={filter}
      initialSelectedVideoId={params.video || ""}
      initialVideos={initialVideos}
      source="tv_feed"
    />
  );
}

function cleanUuid(value: string | undefined) {
  return value && UUID_PATTERN.test(value) ? value : undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
