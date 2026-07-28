import type { Metadata } from "next";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import {
  MYDANCR_AVAILABLE_CITIES,
  resolveMyDancrCity,
} from "@/src/lib/dancr/markets";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import TvFeedClient from "./TvFeedClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MyDancr TV | mydancr",
  description: "Watch approved dancer videos and connect them to real shifts and venues.",
};

type PageProps = {
  searchParams: Promise<{ city?: string; filter?: string; video?: string }>;
};

export default async function MyDancrTvPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const city = resolveMyDancrCity(params.city);
  const filter = params.filter || "for-you";
  const initialVideos = filter === "following"
    ? []
    : await getPublicMyDancrTvFeed(createAdminSupabaseClient(), {
        city,
        filter,
        selectedVideoId: params.video,
        limit: 12,
      });

  return (
    <TvFeedClient
      availableCities={MYDANCR_AVAILABLE_CITIES}
      initialCity={city}
      initialFilter={filter}
      initialSelectedVideoId={params.video || ""}
      initialVideos={initialVideos}
      source="tv_feed"
    />
  );
}
