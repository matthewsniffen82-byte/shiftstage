import type { SupabaseClient } from "@supabase/supabase-js";
import { discoverySnapshot, type DiscoveryContext } from "./discovery-service";
import { getPublicMyDancrTvFeed } from "./tv";

export async function getRankedTvPage(admin: SupabaseClient, context: DiscoveryContext, options: {
  city: string; venueId?: string; filter: string; selectedVideoId?: string; cursor?: string; limit: number;
}) {
  const { snapshot, offset } = await discoverySnapshot(admin, context, {
    surface: "tv", city: options.city, venueId: options.venueId, filter: options.filter,
    selectedVideoId: options.selectedVideoId,
  }, options.cursor);
  const limit = Math.min(24, Math.max(1, options.limit));
  const ids = snapshot.ordered_ids.slice(offset, offset + limit);
  const videos = ids.length ? await getPublicMyDancrTvFeed(admin, {
    city: options.city, venueId: options.venueId, candidateVideoIds: ids, limit: ids.length,
  }) : [];
  const byId = new Map(videos.map(video => [video.id, video]));
  const end = offset + ids.length;
  return {
    videos: ids.flatMap((id,index) => {
      const video = byId.get(id);
      return video
        ? [{ ...video, discovery: { session: snapshot.id, position: offset + index } }] : [];
    }),
    nextCursor: end < snapshot.ordered_ids.length ? `rank1:${snapshot.id}:${end}` : null,
  };
}
