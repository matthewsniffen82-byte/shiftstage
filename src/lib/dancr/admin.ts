import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminApprovalDancer, DancerStatus, ReviewStatus } from "./types";

type DancrClient = SupabaseClient;

const REVIEWABLE_STATUSES = new Set<DancerStatus>(["draft", "pending_review", "rejected"]);
const REVIEW_STATUSES = new Set<ReviewStatus>(["approved", "rejected"]);

export type ReviewDancerInput = {
  dancerId: string;
  reviewerId: string;
  status: ReviewStatus;
  notes?: string | null;
};

export async function requireAdmin(client: DancrClient, userId: string) {
  const { data, error } = await client
    .from("app_users")
    .select("id, role, account_state")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.role !== "admin" || data.account_state !== "active") {
    throw new Error("Admin access required.");
  }
}

export async function getApprovalQueue(client: DancrClient): Promise<AdminApprovalDancer[]> {
  const { data, error } = await (client as any)
    .from("dancer_profiles")
    .select(
      `
        id,
        user_id,
        real_name,
        stage_name,
        slug,
        city,
        bio,
        status,
        verification_status,
        photo_review_status,
        created_at,
        dancer_photos(id, storage_path, is_primary, review_status, sort_order, created_at),
        approval_reviews(id, review_type, status, notes, created_at, reviewed_at)
      `,
    )
    .in("status", Array.from(REVIEWABLE_STATUSES))
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    realName: row.real_name,
    stageName: row.stage_name,
    slug: row.slug,
    city: row.city,
    bio: row.bio,
    status: row.status,
    verificationStatus: row.verification_status,
    photoReviewStatus: row.photo_review_status,
    createdAt: row.created_at,
    photos: (row.dancer_photos || [])
      .map((photo: any) => ({
        id: photo.id,
        imageUrl: photo.storage_path,
        isPrimary: photo.is_primary,
        reviewStatus: photo.review_status,
        sortOrder: photo.sort_order,
        createdAt: photo.created_at,
      }))
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder),
    reviews: (row.approval_reviews || []).map((review: any) => ({
      id: review.id,
      reviewType: review.review_type,
      status: review.status,
      notes: review.notes,
      createdAt: review.created_at,
      reviewedAt: review.reviewed_at,
    })),
  }));
}

export async function reviewDancerProfile(client: DancrClient, input: ReviewDancerInput) {
  if (!REVIEW_STATUSES.has(input.status)) {
    throw new Error("Review status must be approved or rejected.");
  }

  const approved = input.status === "approved";
  const reviewedAt = new Date().toISOString();
  const db = client as any;

  const { data: dancer, error: dancerError } = await db
    .from("dancer_profiles")
    .select("id, user_id, stage_name")
    .eq("id", input.dancerId)
    .maybeSingle();

  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("Dancer profile not found.");

  const { error: updateError } = await db
    .from("dancer_profiles")
    .update({
      status: approved ? "approved" : "rejected",
      verification_status: input.status,
      photo_review_status: input.status,
      approved_at: approved ? reviewedAt : null,
    })
    .eq("id", input.dancerId);

  if (updateError) throw updateError;

  const { error: photosError } = await db
    .from("dancer_photos")
    .update({ review_status: input.status })
    .eq("dancer_id", input.dancerId);

  if (photosError) throw photosError;

  const reviewRows = ["identity", "photos", "profile"].map((reviewType) => ({
    dancer_id: input.dancerId,
    reviewer_id: input.reviewerId,
    review_type: reviewType,
    status: input.status,
    notes: input.notes || null,
    reviewed_at: reviewedAt,
  }));

  const { error: reviewError } = await db.from("approval_reviews").insert(reviewRows);
  if (reviewError) throw reviewError;

  const [{ error: actionError }, { error: notificationError }] = await Promise.all([
    db.from("admin_actions").insert({
      admin_id: input.reviewerId,
      target_type: "dancer_profile",
      target_id: input.dancerId,
      action: approved ? "approve_dancer" : "reject_dancer",
      notes: input.notes || null,
    }),
    db.from("notifications").insert({
      recipient_id: dancer.user_id,
      notification_type: "approval_status",
      channel: "in_app",
      title: approved ? "Your Dancr profile is approved" : "Your Dancr profile needs changes",
      body: approved
        ? `${dancer.stage_name} is now live on Dancr.`
        : "Your profile review is complete. Check the notes and update your setup.",
      payload: { dancerId: input.dancerId, status: input.status },
      sent_at: reviewedAt,
    }),
  ]);

  if (actionError) throw actionError;
  if (notificationError) throw notificationError;

  return {
    dancerId: input.dancerId,
    status: approved ? "approved" : "rejected",
    reviewedAt,
  };
}
