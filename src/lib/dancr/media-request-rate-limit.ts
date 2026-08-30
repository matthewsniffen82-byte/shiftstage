import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "./public-request-rate-limit";

export { PublicRequestRateLimitError as DancerMediaRateLimitError };

export async function enforceDancerMediaRequestRateLimit(
  client: SupabaseClient,
  input: {
    media: "image" | "video";
    request: Request;
    userId: string;
  },
) {
  const video = input.media === "video";
  await enforcePublicRequestRateLimit(client, {
    namespace: video ? "dancer_video_upload" : "dancer_image_upload",
    request: input.request,
    subject: input.userId,
    windowSeconds: 60 * 60,
    ipLimit: video ? 60 : 80,
    subjectLimit: video ? 20 : 24,
  });
}
