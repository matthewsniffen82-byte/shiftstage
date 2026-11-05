import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from "./media-limits";
import type { OnboardingMediaSubmission } from "./dancer-submission-media";

// Use the same current content versions as the batch RPC. An old submission
// cannot satisfy a replacement upload, and an automatic avatar is not a photo.
export async function onboardingMediaSubmission(db: SupabaseClient, dancerId: string): Promise<OnboardingMediaSubmission> {
  const [media, submissions] = await Promise.all([
    db.rpc("dancer_club_media", { p_dancer_ids: [dancerId] }),
    db.from("dancer_media_submissions").select("items").eq("dancer_id", dancerId),
  ]);
  if (media.error) throw media.error;
  if (submissions.error) throw submissions.error;
  const receipts = new Set<string>();
  for (const submission of submissions.data || []) {
    for (const item of submission.items || []) receipts.add(JSON.stringify([item.key, item.version]));
  }
  const photos = new Set<string>(), videos = new Set<string>();
  const submittedPhotos = new Set<string>(), submittedVideos = new Set<string>();
  const rows = media.data || [];
  const approvedPhotoIds = new Set(rows.filter((row: any) => row.kind === "photo" && row.record?.status === "approved")
    .map((row: any) => row.photo_id || row.id));
  for (const row of rows) {
    if (row.dancer_id !== dancerId || row.record?.editor_venue_id) continue;
    const sent = row.record?.status === "approved" || receipts.has(JSON.stringify([`${row.source}:${row.id}`, row.content_version]));
    if (row.kind === "photo") {
      const record = row.record || {};
      if (!/^profile_(main|gallery)(:|$)/.test(record.upload_context || "")) continue;
      if (record.photo_publication_mode === "replace" && approvedPhotoIds.has(record.replacement_photo_id)) continue;
      const key = row.is_main ? "main" : record.photo_publication_mode === "replace" ? `replacement:${record.replacement_photo_id}` : row.id;
      photos.add(key);
      if (sent) submittedPhotos.add(key);
    } else if (row.kind === "video" && row.record?.distribution_scope !== "feed_only") {
      videos.add(row.id);
      if (sent) submittedVideos.add(row.id);
    }
  }
  const complete = (photos: Set<string>, videos: Set<string>) => photos.has("main")
    && photos.size >= MIN_DANCER_ONBOARDING_PHOTOS && videos.size >= MIN_DANCER_ONBOARDING_VIDEOS;
  return { ready: complete(photos, videos), submitted: complete(submittedPhotos, submittedVideos) };
}
