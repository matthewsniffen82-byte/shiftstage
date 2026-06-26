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

export type AdminVenueInput = {
  name?: string;
  slug?: string;
  city?: string;
  state?: string | null;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  timezone?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  isActive?: boolean;
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

export async function getAdminVenues(client: DancrClient, city?: string | null) {
  let query = (client as any)
    .from("venues")
    .select("id, slug, name, city, state, address, phone, website, timezone, opens_at, closes_at, is_active, created_at, updated_at")
    .order("city", { ascending: true })
    .order("name", { ascending: true });

  if (city) query = query.eq("city", city);

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

export async function createAdminVenue(client: DancrClient, adminId: string, input: AdminVenueInput) {
  if (!input.name?.trim()) throw new Error("Venue name is required.");
  if (!input.city?.trim()) throw new Error("Venue city is required.");

  const row = venueInputToRow(input, true);
  const { data, error } = await (client as any)
    .from("venues")
    .insert(row)
    .select("id, slug, name, city, state, address, phone, website, timezone, opens_at, closes_at, is_active")
    .single();

  if (error) throw error;

  await logAdminAction(client, {
    adminId,
    targetType: "venue",
    targetId: data.id,
    action: "create_venue",
    notes: data.name,
  });

  return data;
}

export async function updateAdminVenue(
  client: DancrClient,
  adminId: string,
  venueId: string,
  input: AdminVenueInput,
) {
  const row = venueInputToRow(input, false);
  if (!Object.keys(row).length) throw new Error("No venue updates provided.");

  const { data, error } = await (client as any)
    .from("venues")
    .update(row)
    .eq("id", venueId)
    .select("id, slug, name, city, state, address, phone, website, timezone, opens_at, closes_at, is_active")
    .single();

  if (error) throw error;

  await logAdminAction(client, {
    adminId,
    targetType: "venue",
    targetId: data.id,
    action: "update_venue",
    notes: data.name,
  });

  return data;
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

function venueInputToRow(input: AdminVenueInput, creating: boolean) {
  const row: Record<string, string | boolean | null> = {};

  if (typeof input.name === "string") {
    row.name = requiredText(input.name, "Venue name is required.");
    if (!input.slug) row.slug = slugify(input.name);
  }

  if (typeof input.slug === "string") row.slug = requiredText(input.slug, "Venue slug is required.");
  if (typeof input.city === "string") row.city = requiredText(input.city, "Venue city is required.");
  if ("state" in input) row.state = optionalText(input.state);
  if ("address" in input) row.address = optionalText(input.address);
  if ("phone" in input) row.phone = optionalText(input.phone);
  if ("website" in input) row.website = optionalText(input.website);
  if ("timezone" in input) row.timezone = optionalText(input.timezone) || "America/Los_Angeles";
  if ("opensAt" in input) row.opens_at = optionalText(input.opensAt);
  if ("closesAt" in input) row.closes_at = optionalText(input.closesAt);
  if (typeof input.isActive === "boolean") row.is_active = input.isActive;

  if (creating) {
    row.slug = row.slug || slugify(String(row.name));
    row.timezone = row.timezone || "America/Los_Angeles";
    row.is_active = input.isActive !== false;
  }

  return row;
}

async function logAdminAction(
  client: DancrClient,
  input: { adminId: string; targetType: string; targetId: string; action: string; notes?: string | null },
) {
  const { error } = await (client as any).from("admin_actions").insert({
    admin_id: input.adminId,
    target_type: input.targetType,
    target_id: input.targetId,
    action: input.action,
    notes: input.notes || null,
  });

  if (error) throw error;
}

function requiredText(value: string, message: string) {
  const text = value.trim();
  if (!text) throw new Error(message);
  return text;
}

function optionalText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
