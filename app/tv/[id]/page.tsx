import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MYDANCR_AVAILABLE_CITIES } from "@/src/lib/dancr/markets";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import TvFeedClient from "../TvFeedClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const videos = await getPublicMyDancrTvFeed(createAdminSupabaseClient(), {
    selectedVideoId: id,
    limit: 1,
  });
  const video = videos.find((item) => item.id === id);
  if (!video) return { title: "MyDancr TV | mydancr" };
  return {
    title: `${video.dancer.stageName} on MyDancr TV`,
    description: video.caption,
  };
}

export default async function SharedMyDancrTvPage({ params }: PageProps) {
  const { id } = await params;
  const initialVideos = await getPublicMyDancrTvFeed(createAdminSupabaseClient(), {
    selectedVideoId: id,
    limit: 12,
  });
  const selected = initialVideos.find((video) => video.id === id);
  if (!selected) notFound();

  return (
    <TvFeedClient
      availableCities={MYDANCR_AVAILABLE_CITIES}
      initialCity={selected.dancer.city}
      initialFilter="for-you"
      initialSelectedVideoId={id}
      initialVideos={[selected, ...initialVideos.filter((video) => video.id !== id)]}
      source="shared_link"
    />
  );
}
