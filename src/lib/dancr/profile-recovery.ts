import type { SupabaseClient } from "@supabase/supabase-js";
import { automaticDancerApprovalValues } from "./profile-approval";

let pendingRepair: Promise<number> | null = null;

export function ensureAutomaticPublicProfileConsistency(client: SupabaseClient): Promise<number> {
  if (!pendingRepair) {
    pendingRepair = restoreMediaReadyProfiles(client).catch((error) => {
      pendingRepair = null;
      throw error;
    });
  }
  return pendingRepair;
}

async function restoreMediaReadyProfiles(client: SupabaseClient): Promise<number> {
  const admin = client as any;
  const { data: candidates, error: candidateError } = await admin
    .from("dancer_profiles")
    .select("id, user_id, stage_name, city, avatar_storage_path, photo_review_status, venue_approved_at")
    .eq("status", "pending_review")
    .eq("verification_status", "pending")
    .not("venue_approved_at", "is", null)
    .is("disabled_at", null);
  if (candidateError) throw candidateError;
  if (!candidates?.length) return 0;

  const dancerIds = candidates.map((profile: any) => profile.id);
  const userIds = candidates.map((profile: any) => profile.user_id);
  const [photosResult, videosResult, accountsResult] = await Promise.all([
    admin.from("dancer_photos").select("dancer_id, review_status").in("dancer_id", dancerIds),
    admin.from("mydancr_tv_videos").select("dancer_id, status").in("dancer_id", dancerIds),
    admin.from("app_users").select("id, role, account_state").in("id", userIds),
  ]);
  if (photosResult.error) throw photosResult.error;
  if (videosResult.error) throw videosResult.error;
  if (accountsResult.error) throw accountsResult.error;

  const accounts = new Map((accountsResult.data || []).map((account: any) => [account.id, account]));
  const eligibleIds = candidates
    .filter((profile: any) => {
      const account: any = accounts.get(profile.user_id);
      const photos = (photosResult.data || []).filter((photo: any) => photo.dancer_id === profile.id);
      const videos = (videosResult.data || []).filter((video: any) => video.dancer_id === profile.id);
      return account?.role === "dancer"
        && account?.account_state === "active"
        && Boolean(String(profile.stage_name || "").trim())
        && Boolean(String(profile.city || "").trim())
        && Boolean(String(profile.avatar_storage_path || "").trim())
        && profile.photo_review_status === "approved"
        && photos.some((photo: any) => photo.review_status === "approved")
        && photos.every((photo: any) => photo.review_status === "approved")
        && videos.every((video: any) => !["uploading", "moderating", "submitted"].includes(video.status));
    })
    .map((profile: any) => profile.id);

  if (!eligibleIds.length) return 0;
  const { data: restored, error: restoreError } = await admin
    .from("dancer_profiles")
    .update(automaticDancerApprovalValues())
    .in("id", eligibleIds)
    .eq("status", "pending_review")
    .eq("verification_status", "pending")
    .not("venue_approved_at", "is", null)
    .is("disabled_at", null)
    .select("id");
  if (restoreError) throw restoreError;

  const restoredCount = restored?.length || 0;
  if (restoredCount) console.info("AUTOMATIC_PUBLIC_PROFILES_RESTORED", { restoredCount });
  return restoredCount;
}
