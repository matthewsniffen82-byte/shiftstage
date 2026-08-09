import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { homeTvHref } from "@/src/lib/dancr/navigation";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

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
    description: `Watch ${video.dancer.stageName} on MyDancr TV.`,
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

  permanentRedirect(homeTvHref(selected.dancer.city, { videoId: id }));
}
