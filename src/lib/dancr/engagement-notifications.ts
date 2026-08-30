import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicDancerProfileEligible } from "./profile-approval";

type DancrClient = SupabaseClient;
export type EngagementTargetType = "profile" | "photo" | "video";
export type DancerEngagementRecipient = {
  dancerId: string;
  dancerSlug: string;
  recipientId: string;
};

const PROFILE_FIELDS = "id, user_id, slug, status, approved_at, venue_approved_at, disabled_at, verification_status, photo_review_status, is_public";

export async function resolvePublicDancerEngagementTarget(
  client: DancrClient,
  targetType: EngagementTargetType,
  targetId: string,
): Promise<DancerEngagementRecipient | null> {
  if (targetType === "profile") {
    const { data, error } = await (client as any)
      .from("dancer_profiles")
      .select(PROFILE_FIELDS)
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw error;
    return publicRecipient(data);
  }

  const table = targetType === "photo" ? "dancer_photos" : "mydancr_tv_videos";
  let query = (client as any)
    .from(table)
    .select(`id, ${targetType === "photo" ? "review_status" : "status, published_at, expires_at"}, dancer_profiles!inner(${PROFILE_FIELDS})`)
    .eq("id", targetId);
  query = targetType === "photo"
    ? query.eq("review_status", "approved")
    : query.eq("status", "approved");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (targetType === "video") {
    const now = Date.now();
    const publishedAt = new Date(data.published_at || "").getTime();
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
    if (
      !Number.isFinite(publishedAt)
      || publishedAt > now
      || (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now))
    ) return null;
  }
  return publicRecipient(one(data.dancer_profiles));
}

export async function createDancerEngagementNotification(
  client: DancrClient,
  recipient: DancerEngagementRecipient,
  input: {
    engagementType: "like" | "follow" | "share";
    targetType: EngagementTargetType;
    targetId: string;
    dedupeSubject: string;
  },
) {
  const copy = engagementCopy(input.engagementType, input.targetType);
  const now = new Date().toISOString();
  const notificationId = deterministicNotificationId([
    "engagement",
    recipient.recipientId,
    input.engagementType,
    input.targetType,
    input.targetId,
    input.dedupeSubject,
  ].join(":"));
  const href = input.targetType === "profile"
    ? `/dancers/${encodeURIComponent(recipient.dancerSlug)}`
    : `/dancers/${encodeURIComponent(recipient.dancerSlug)}?media=${input.targetType}&mediaId=${encodeURIComponent(input.targetId)}`;
  const { error } = await (client as any).from("notifications").insert({
    id: notificationId,
    recipient_id: recipient.recipientId,
    notification_type: "engagement",
    channel: "in_app",
    title: copy.title,
    body: copy.body,
    payload: {
      engagementType: input.engagementType,
      targetType: input.targetType,
      dancerId: recipient.dancerId,
      dancerSlug: recipient.dancerSlug,
      targetId: input.targetId,
      href,
    },
    sent_at: now,
  });
  if (error && error.code !== "23505") throw error;
  return { created: !error, notificationId };
}

function engagementCopy(
  engagementType: "like" | "follow" | "share",
  targetType: EngagementTargetType,
) {
  if (engagementType === "follow") {
    return {
      title: "New follower",
      body: "Someone started following your dancer profile.",
    };
  }
  const label = targetType === "photo" ? "photo" : targetType === "video" ? "video" : "profile";
  return engagementType === "like"
    ? {
        title: `New ${label} like`,
        body: `Someone liked your ${label}.`,
      }
    : {
        title: `Your ${label} was shared`,
        body: `Someone shared your ${label}.`,
      };
}

function publicRecipient(profile: any): DancerEngagementRecipient | null {
  if (!profile || !isPublicDancerProfileEligible(profile)) return null;
  const dancerId = String(profile.id || "");
  const recipientId = String(profile.user_id || "");
  const dancerSlug = String(profile.slug || "");
  return dancerId && recipientId && dancerSlug
    ? { dancerId, recipientId, dancerSlug }
    : null;
}

function deterministicNotificationId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const normalized = hex.join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function one(value: any) {
  return Array.isArray(value) ? value[0] : value;
}
