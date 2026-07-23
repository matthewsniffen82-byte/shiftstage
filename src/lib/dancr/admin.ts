import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminApprovalDancer, DancerStatus, ReviewStatus } from "./types";
import { deliverNotificationRows } from "./notification-delivery";

type DancrClient = SupabaseClient;

const REVIEWABLE_STATUSES = new Set<DancerStatus>(["draft", "pending_review", "rejected"]);
const ADMIN_DIRECTORY_STATUSES = new Set<DancerStatus>(["draft", "pending_review", "approved", "rejected", "disabled"]);
const REVIEW_STATUSES = new Set<ReviewStatus>(["approved", "rejected"]);
const APPROVAL_QUEUE_SELECT = `
  id,
  user_id,
  real_name,
  stage_name,
  slug,
  city,
  bio,
  status,
  is_public,
  verification_status,
  photo_review_status,
  created_at,
  social_links(id, platform, handle, url, is_active),
  dancer_photos(id, storage_path, is_primary, review_status, sort_order, created_at),
  approval_reviews(id, review_type, status, notes, created_at, reviewed_at)
`;
const APPROVAL_QUEUE_SELECT_WITHOUT_VISIBILITY = APPROVAL_QUEUE_SELECT.replace(/\n\s*is_public,\s*/m, "\n");

export type ReviewDancerInput = {
  dancerId: string;
  reviewerId: string;
  status: ReviewStatus;
  notes?: string | null;
};

export type ReviewSubmissionContentInput = {
  dancerId: string;
  reviewerId: string;
  targetType: "photo" | "verification_document" | "social_link";
  targetId: string;
  status: ReviewStatus;
  notes?: string | null;
  label?: string | null;
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

export type AdminContentReportAction = "resolved" | "removed";

export type AdminMonitoringStatus = {
  checkedAt: string;
  database: Array<{ name: string; ok: boolean; count: number | null; error?: string }>;
  integrations: Array<{ name: string; ok: boolean; required: string[] }>;
};

type TrendingMetricCounts = {
  profileViews: number;
  scheduleViews: number;
  followers: number;
  favorites: number;
  directionRequests: number;
  goingSignals: number;
  notificationOpens: number;
  socialClicks: number;
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
  const db = client as any;
  const pendingContentDancerIds = await pendingContentReviewDancerIds(db);
  const data = await selectApprovalRows(db, (query) =>
    query
      .or(`status.in.(${Array.from(REVIEWABLE_STATUSES).join(",")}),photo_review_status.eq.pending`)
      .order("created_at", { ascending: true }),
  );

  const rowsById = new Map((data || []).map((row: any) => [row.id, row]));
  const missingPendingContentIds = pendingContentDancerIds.filter((id) => !rowsById.has(id));
  if (missingPendingContentIds.length) {
    const contentRows = await selectApprovalRows(db, (query) =>
      query
        .in("id", missingPendingContentIds)
        .order("created_at", { ascending: true }),
    );
    (contentRows || []).forEach((row: any) => rowsById.set(row.id, row));
  }

  return Promise.all(Array.from(rowsById.values()).map((row: any) => mapAdminApprovalDancer(client, row)));
}

export async function getAdminDancerDirectory(client: DancrClient): Promise<AdminApprovalDancer[]> {
  const data = await selectApprovalRows((client as any), (query) =>
    query
      .in("status", Array.from(ADMIN_DIRECTORY_STATUSES))
      .order("created_at", { ascending: false }),
  );

  return Promise.all((data || []).map((row: any) => mapAdminApprovalDancer(client, row)));
}

async function selectApprovalRows(db: any, configure: (query: any) => any) {
  const { data, error } = await configure(db.from("dancer_profiles").select(APPROVAL_QUEUE_SELECT));
  if (!error) return data || [];
  if (!isMissingVisibilityColumnError(error)) throw error;

  const { data: fallbackData, error: fallbackError } = await configure(
    db.from("dancer_profiles").select(APPROVAL_QUEUE_SELECT_WITHOUT_VISIBILITY),
  );
  if (fallbackError) throw fallbackError;
  return fallbackData || [];
}

function isMissingVisibilityColumnError(error: any) {
  const message = String(error?.message || error?.details || "");
  return error?.code === "42703" && message.includes("is_public");
}

async function mapAdminApprovalDancer(client: DancrClient, row: any): Promise<AdminApprovalDancer> {
  const reviews = row.approval_reviews || [];
  return {
    id: row.id,
    userId: row.user_id,
    realName: row.real_name,
    stageName: row.stage_name,
    slug: row.slug,
    city: row.city,
    bio: row.bio,
    status: row.status,
    isPublic: row.is_public !== false,
    verificationStatus: row.verification_status,
    photoReviewStatus: row.photo_review_status,
    createdAt: row.created_at,
    socialLinks: (row.social_links || [])
      .filter((social: any) => social.is_active !== false)
      .map((social: any) => {
        const review = latestReviewFor(reviews, contentReviewType("social_link", social.id));
        const defaultReviewStatus = row.status === "approved" ? "approved" : "pending";
        return {
          id: social.id,
          platform: social.platform,
          handle: social.handle,
          url: social.url,
          reviewStatus: review?.status || defaultReviewStatus,
          reviewNotes: review?.notes || null,
          reviewedAt: review?.reviewed_at || null,
        };
      }),
    photos: (row.dancer_photos || [])
      .map((photo: any) => {
        const review = latestReviewFor(reviews, contentReviewType("photo", photo.id));
        return {
          id: photo.id,
          imageUrl: toDancerPhotoUrl(client, photo.storage_path),
          isPrimary: photo.is_primary,
          reviewStatus: review?.status || photo.review_status,
          reviewNotes: review?.notes || null,
          reviewedAt: review?.reviewed_at || null,
          sortOrder: photo.sort_order,
          createdAt: photo.created_at,
        };
      })
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder),
    verificationDocuments: await listVerificationDocumentsForUser(client, row.user_id, reviews),
    reviews: reviews.map((review: any) => ({
      id: review.id,
      reviewType: review.review_type,
      status: review.status,
      notes: review.notes,
      createdAt: review.created_at,
      reviewedAt: review.reviewed_at,
    })),
  };
}

async function pendingContentReviewDancerIds(db: any): Promise<string[]> {
  const { data, error } = await db
    .from("approval_reviews")
    .select("dancer_id, review_type")
    .eq("status", "pending");

  if (error) throw error;

  return [
    ...new Set<string>(
      (data || [])
        .filter((review: any) => /^(photo|social_link|verification_document):/.test(String(review.review_type || "")))
        .map((review: any) => review.dancer_id)
        .filter(Boolean),
    ),
  ];
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

export async function getAdminSubscriptions(client: DancrClient, status?: string | null) {
  let query = (client as any)
    .from("subscriptions")
    .select(
      `
        id,
        dancer_id,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        status,
        current_period_end,
        created_at,
        updated_at,
        dancer_profiles(id, stage_name, slug, city, status, user_id)
      `,
    )
    .order("updated_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row: any) => {
    const dancer = Array.isArray(row.dancer_profiles) ? row.dancer_profiles[0] : row.dancer_profiles;

    return {
      id: row.id,
      dancerId: row.dancer_id,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripePriceId: row.stripe_price_id,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dancer: dancer
        ? {
            id: dancer.id,
            userId: dancer.user_id,
            stageName: dancer.stage_name,
            slug: dancer.slug,
            city: dancer.city,
            status: dancer.status,
          }
        : null,
    };
  });
}

export async function getContentReports(client: DancrClient, status = "open") {
  let query = (client as any)
    .from("content_reports")
    .select("id, reporter_id, target_type, target_id, target_label, reason, details, status, reviewed_by, reviewed_at, created_at")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((report: any) => ({
    id: report.id,
    reporterId: report.reporter_id,
    targetType: report.target_type,
    targetId: report.target_id,
    targetLabel: report.target_label,
    reason: report.reason,
    details: report.details,
    status: report.status,
    reviewedBy: report.reviewed_by,
    reviewedAt: report.reviewed_at,
    createdAt: report.created_at,
  }));
}

export async function updateContentReport(
  client: DancrClient,
  adminId: string,
  reportId: string,
  action: AdminContentReportAction,
) {
  const reviewedAt = new Date().toISOString();
  const db = client as any;
  const { data: report, error: reportError } = await db
    .from("content_reports")
    .select("id, target_type, target_id, target_label, reason")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError) throw reportError;
  if (!report) throw new Error("Report not found.");

  if (action === "removed" && report.target_type === "dancer_profile" && report.target_id) {
    const { error: dancerError } = await db
      .from("dancer_profiles")
      .update({ status: "disabled" })
      .eq("id", report.target_id);

    if (dancerError) throw dancerError;
  }

  const { data, error } = await db
    .from("content_reports")
    .update({
      status: action,
      reviewed_by: adminId,
      reviewed_at: reviewedAt,
    })
    .eq("id", reportId)
    .select("id, target_type, target_id, target_label, reason, details, status, reviewed_by, reviewed_at, created_at")
    .single();

  if (error) throw error;

  await logAdminAction(client, {
    adminId,
    targetType: "content_report",
    targetId: reportId,
    action: action === "removed" ? "remove_reported_target" : "resolve_report",
    notes: `${report.reason}: ${report.target_label}`,
  });

  return {
    id: data.id,
    targetType: data.target_type,
    targetId: data.target_id,
    targetLabel: data.target_label,
    reason: data.reason,
    details: data.details,
    status: data.status,
    reviewedBy: data.reviewed_by,
    reviewedAt: data.reviewed_at,
    createdAt: data.created_at,
  };
}

export async function getAdminMonitoringStatus(client: DancrClient): Promise<AdminMonitoringStatus> {
  const [users, venues, dancers, reports, notifications, subscriptions] = await Promise.all([
    countTable(client, "app_users"),
    countTable(client, "venues"),
    countTable(client, "dancer_profiles"),
    countTable(client, "content_reports"),
    countTable(client, "notifications"),
    countTable(client, "subscriptions"),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    database: [
      { name: "Users", ...users },
      { name: "Venues", ...venues },
      { name: "Dancer profiles", ...dancers },
      { name: "Content reports", ...reports },
      { name: "Notifications", ...notifications },
      { name: "Subscriptions", ...subscriptions },
    ],
    integrations: [
      integrationStatus("Supabase", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]),
      integrationStatus("Stripe", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]),
      integrationStatus("OneSignal", ["NEXT_PUBLIC_ONESIGNAL_APP_ID", "ONESIGNAL_REST_API_KEY"]),
      integrationStatus("Resend", ["RESEND_API_KEY", "EMAIL_FROM"]),
      integrationStatus("Google Maps", ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"]),
    ],
  };
}

export async function recalculateCityRankings(client: DancrClient, adminId: string, city: string) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: dancers, error } = await (client as any)
    .from("dancer_profiles")
    .select("id, user_id, stage_name, city, trending_scores(rank, highest_rank, best_rank_this_week)")
    .eq("status", "approved")
    .eq("city", city);

  if (error) throw error;

  const scored = await Promise.all(
    (dancers || []).map(async (dancer: any) => {
      const metrics = await getTrendingMetricCounts(client, dancer.id, since);
      const previous = Array.isArray(dancer.trending_scores) ? dancer.trending_scores[0] : dancer.trending_scores;

      return {
        dancer,
        metrics,
        previousRank: previous?.rank || null,
        previousHighestRank: previous?.highest_rank || null,
        previousBestRankThisWeek: previous?.best_rank_this_week || null,
        score: calculateTrendingScore(metrics),
      };
    }),
  );

  scored.sort((a, b) => b.score - a.score || a.dancer.stage_name.localeCompare(b.dancer.stage_name));

  const calculatedAt = new Date().toISOString();
  const rankingRows = scored.map((entry, index) => {
    const rank = index + 1;
    const highestRank = entry.previousHighestRank
      ? Math.min(entry.previousHighestRank, rank)
      : rank;
    const bestRankThisWeek = entry.previousBestRankThisWeek
      ? Math.min(entry.previousBestRankThisWeek, rank)
      : rank;

    return {
      dancer_id: entry.dancer.id,
      city,
      score: entry.score,
      rank,
      previous_rank: entry.previousRank,
      highest_rank: highestRank,
      best_rank_this_week: bestRankThisWeek,
      trend: getRankTrend(entry.previousRank, rank),
      calculated_at: calculatedAt,
    };
  });

  if (rankingRows.length) {
    const { error: upsertError } = await (client as any)
      .from("trending_scores")
      .upsert(rankingRows, { onConflict: "dancer_id" });

    if (upsertError) throw upsertError;
  }

  const milestoneRows = scored
    .map((entry, index) => getRankingMilestone(entry.dancer, city, entry.previousRank, index + 1))
    .filter(Boolean);
  const biggestMover = getBiggestMoverMilestone(scored, city);
  if (biggestMover) milestoneRows.push(biggestMover);

  if (milestoneRows.length) {
    const { error: eventError } = await (client as any).from("ranking_events").insert(
      milestoneRows.map((event: any) => ({
        dancer_id: event.dancer_id,
        city: event.city,
        event_type: event.event_type,
        old_rank: event.old_rank,
        new_rank: event.new_rank,
        message: event.message,
        notified_at: event.notified_at,
      })),
    );
    if (eventError) throw eventError;

    const notificationRows = milestoneRows.map((event: any) => ({
      recipient_id: event.userId,
      notification_type: "ranking_milestone" as const,
      channel: "in_app",
      title: "Trending ranking update",
      body: event.message,
      payload: {
        dancerId: event.dancer_id,
        city: event.city,
        oldRank: event.old_rank,
        newRank: event.new_rank,
        eventType: event.event_type,
      },
      sent_at: calculatedAt,
    }));

    const { error: notificationError } = await (client as any).from("notifications").insert(notificationRows);

    if (notificationError) throw notificationError;
    await deliverNotificationRows(client, notificationRows);
  }

  await logAdminAction(client, {
    adminId,
    targetType: "city",
    targetId: "00000000-0000-0000-0000-000000000000",
    action: "recalculate_rankings",
    notes: `${city}: ${rankingRows.length} dancers`,
  });

  return rankingRows;
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
    .select("id, user_id, stage_name, disabled_at")
    .eq("id", input.dancerId)
    .maybeSingle();

  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("Dancer profile not found.");

  if (approved) {
    const { data: account, error: accountError } = await db
      .from("app_users")
      .select("account_state")
      .eq("id", dancer.user_id)
      .maybeSingle();
    if (accountError) throw accountError;
    if (account?.account_state !== "active" || dancer.disabled_at) {
      throw new Error("Reactivate the dancer account before approving this profile.");
    }
    await assertAllSubmittedContentReviewed(client, dancer);
  }

  const statusUpdate = approved
    ? {
        status: "approved",
        verification_status: input.status,
        approved_at: reviewedAt,
      }
    : {
        status: "rejected",
        approved_at: null,
      };

  const { error: updateError } = await db
    .from("dancer_profiles")
    .update(statusUpdate)
    .eq("id", input.dancerId);

  if (updateError) throw updateError;

  const reviewTypes = approved ? ["identity", "profile"] : ["profile"];
  const reviewRows = reviewTypes.map((reviewType) => ({
    dancer_id: input.dancerId,
    reviewer_id: input.reviewerId,
    review_type: reviewType,
    status: input.status,
    notes: input.notes || null,
    reviewed_at: reviewedAt,
  }));

  const { error: reviewError } = await db.from("approval_reviews").insert(reviewRows);
  if (reviewError) throw reviewError;

  const approvalIssues = await profileApprovalIssueSummary(client, input.dancerId);
  const notificationCopy = dancerApprovalNotificationCopy(dancer.stage_name, approved, input.notes, approvalIssues);
  const notificationRow = {
    recipient_id: dancer.user_id,
    notification_type: "approval_status" as const,
    channel: "in_app",
    title: notificationCopy.title,
    body: notificationCopy.body,
    payload: { dancerId: input.dancerId, status: input.status, notes: input.notes || null, setupStep: approved ? null : "approval", reviewedAt },
    sent_at: reviewedAt,
  };

  const [{ error: actionError }, { error: notificationError }] = await Promise.all([
    db.from("admin_actions").insert({
      admin_id: input.reviewerId,
      target_type: "dancer_profile",
      target_id: input.dancerId,
      action: approved ? "approve_dancer" : "reject_dancer",
      notes: input.notes || null,
    }),
    db.from("notifications").insert(notificationRow),
  ]);

  if (actionError) throw actionError;
  if (notificationError) throw notificationError;
  const notificationDelivery = await deliverNotificationRows(client, [notificationRow]);

  return {
    dancerId: input.dancerId,
    status: approved ? "approved" : "rejected",
    reviewedAt,
    notificationDelivery,
  };
}

export async function reviewSubmissionContent(client: DancrClient, input: ReviewSubmissionContentInput) {
  if (!REVIEW_STATUSES.has(input.status)) {
    throw new Error("Review status must be approved or rejected.");
  }

  const notes = optionalText(input.notes);
  if (input.status === "rejected" && !notes) {
    throw new Error("Add a reason before disapproving this submitted item.");
  }

  const reviewedAt = new Date().toISOString();
  const db = client as any;
  const { data: dancer, error: dancerError } = await db
    .from("dancer_profiles")
    .select("id, user_id, stage_name, status")
    .eq("id", input.dancerId)
    .maybeSingle();

  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("Dancer profile not found.");

  const reviewType = contentReviewType(input.targetType, input.targetId);
  if (input.targetType === "photo") {
    const { data: photo, error: photoError } = await db
      .from("dancer_photos")
      .update({ review_status: input.status })
      .eq("id", input.targetId)
      .eq("dancer_id", input.dancerId)
      .select("id")
      .maybeSingle();

    if (photoError) throw photoError;
    if (!photo) throw new Error("Submitted photo not found.");
    await updatePhotoReviewSummary(client, input.dancerId);
  } else if (input.targetType === "verification_document") {
    const expectedPrefix = `${dancer.user_id}/verification/`;
    if (!input.targetId.startsWith(expectedPrefix)) {
      throw new Error("Verification file not found for this dancer.");
    }
  } else {
    const { data: social, error: socialError } = await db
      .from("social_links")
      .select("id")
      .eq("id", input.targetId)
      .eq("dancer_id", input.dancerId)
      .maybeSingle();

    if (socialError) throw socialError;
    if (!social) throw new Error("Submitted social link not found.");
  }

  const { data: pendingReview, error: pendingReviewError } = await db
    .from("approval_reviews")
    .select("id")
    .eq("dancer_id", input.dancerId)
    .eq("review_type", reviewType)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingReviewError) throw pendingReviewError;

  if (pendingReview?.id) {
    const { error: reviewError } = await db
      .from("approval_reviews")
      .update({
        reviewer_id: input.reviewerId,
        status: input.status,
        notes,
        reviewed_at: reviewedAt,
      })
      .eq("id", pendingReview.id);
    if (reviewError) throw reviewError;
  } else {
    const { error: reviewError } = await db.from("approval_reviews").insert({
      dancer_id: input.dancerId,
      reviewer_id: input.reviewerId,
      review_type: reviewType,
      status: input.status,
      notes,
      reviewed_at: reviewedAt,
    });
    if (reviewError) throw reviewError;
  }

  if (input.targetType === "verification_document") {
    await updateVerificationReviewSummary(client, dancer.user_id, input.dancerId);
  } else if (input.targetType === "social_link") {
    await updatePhotoReviewSummary(client, input.dancerId);
  }

  await logAdminAction(client, {
    adminId: input.reviewerId,
    targetType: input.targetType,
    targetId: input.dancerId,
    action: input.status === "approved" ? "approve_submitted_content" : "reject_submitted_content",
    notes: `${input.label || input.targetId}${notes ? `: ${notes}` : ""}`,
  });

  const isApprovedProfileContentFix = dancer.status === "approved" && (input.targetType === "photo" || input.targetType === "social_link");
  let notificationDelivery = null;
  if (input.status === "rejected" || isApprovedProfileContentFix) {
    const notificationCopy =
      input.status === "approved"
        ? submittedContentApprovedNotificationCopy(input.targetType, input.label)
        : submittedContentRejectedNotificationCopy(input.targetType, input.label, notes);
    const notificationRow = {
      recipient_id: dancer.user_id,
      notification_type: "approval_status" as const,
      channel: "in_app",
      title: notificationCopy.title,
      body: notificationCopy.body,
      payload: {
        dancerId: input.dancerId,
        status: input.status,
        targetType: input.targetType,
        targetId: input.targetId,
        label: input.label || notificationCopy.label,
        notes,
        setupStep: setupStepForRejectedContent(input.targetType),
        reviewedAt,
      },
      sent_at: reviewedAt,
    };
    const { error: notificationError } = await db.from("notifications").insert(notificationRow);
    if (notificationError) throw notificationError;
    notificationDelivery = await deliverNotificationRows(client, [notificationRow], { email: isApprovedProfileContentFix });
  }

  return {
    dancerId: input.dancerId,
    targetType: input.targetType,
    targetId: input.targetId,
    status: input.status,
    reviewedAt,
    notificationDelivery,
  };
}

function dancerApprovalNotificationCopy(
  stageName: string | null | undefined,
  approved: boolean,
  notes?: string | null,
  approvalIssues: string[] = [],
) {
  const displayName = stageName?.trim() || "Your Dancr profile";
  const issueCopy = approvalIssues.length ? ` Items to fix: ${approvalIssues.join("; ")}.` : "";
  if (approved) {
    return {
      title: "Your Dancr profile is approved",
      body: `${displayName} is approved and live on Dancr. You can now post shifts, manage your public profile, and share your page.${issueCopy}`,
    };
  }

  const reviewNotes = notes?.trim() ? ` Notes: ${notes.trim()}` : "";
  return {
    title: "Your Dancr profile needs changes",
    body: `Your Dancr profile review is complete. Update your verification setup and resubmit.${reviewNotes}${issueCopy}`,
  };
}

async function profileApprovalIssueSummary(client: DancrClient, dancerId: string) {
  const db = client as any;
  const { data, error } = await db
    .from("approval_reviews")
    .select("review_type, status, notes, created_at, reviewed_at")
    .eq("dancer_id", dancerId);

  if (error) throw error;

  const latestByType = new Map<string, any>();
  for (const review of data || []) {
    const reviewType = review.review_type;
    const previous = latestByType.get(reviewType);
    const reviewTime = Date.parse(review.reviewed_at || review.created_at || "") || 0;
    const previousTime = previous ? Date.parse(previous.reviewed_at || previous.created_at || "") || 0 : -1;
    if (!previous || reviewTime >= previousTime) latestByType.set(reviewType, review);
  }

  return Array.from(latestByType.entries())
    .filter(([reviewType, review]) => review.status === "rejected" && reviewType !== "profile" && reviewType !== "identity")
    .map(([reviewType, review]) => {
      const label = approvalIssueLabel(reviewType);
      return review.notes ? `${label} - ${review.notes}` : label;
    });
}

function approvalIssueLabel(reviewType: string) {
  if (reviewType.startsWith("photo:")) return "Profile photo";
  if (reviewType.startsWith("social_link:")) return "Social link";
  if (reviewType.startsWith("verification_document:")) {
    const normalized = reviewType.toLowerCase();
    if (normalized.includes("selfie")) return "Selfie verification";
    if (normalized.includes("proof") || normalized.includes("dance")) return "Proof that they dance";
    if (normalized.includes("id") || normalized.includes("license") || normalized.includes("passport")) return "Government ID";
    return "Verification file";
  }
  if (reviewType === "identity") return "Identity review";
  return "Profile review";
}

function submittedContentRejectedNotificationCopy(targetType: ReviewSubmissionContentInput["targetType"], label?: string | null, notes?: string | null) {
  const itemLabel = label?.trim() || rejectedContentLabel(targetType);
  const reason = notes?.trim() ? ` Reason: ${notes.trim()}` : "";
  return {
    title: `${itemLabel} needs changes`,
    body: `Dancr reviewed your ${itemLabel.toLowerCase()} and needs you to fix or resend it.${reason}`,
    label: itemLabel,
  };
}

function submittedContentApprovedNotificationCopy(targetType: ReviewSubmissionContentInput["targetType"], label?: string | null) {
  const itemLabel = label?.trim() || rejectedContentLabel(targetType);
  return {
    title: `${itemLabel} approved`,
    body: `Dancr approved your ${itemLabel.toLowerCase()} update. Your live profile has been updated for that item.`,
    label: itemLabel,
  };
}

function rejectedContentLabel(targetType: ReviewSubmissionContentInput["targetType"]) {
  if (targetType === "photo") return "Profile photo";
  if (targetType === "verification_document") return "Verification file";
  return "Social link";
}

function setupStepForRejectedContent(targetType: ReviewSubmissionContentInput["targetType"]) {
  if (targetType === "photo") return "photos";
  if (targetType === "verification_document") return "verification";
  return "profile";
}

async function getTrendingMetricCounts(client: DancrClient, dancerId: string, since: Date): Promise<TrendingMetricCounts> {
  const [
    profileViews,
    scheduleViews,
    followers,
    favorites,
    directionRequests,
    goingSignals,
    notificationOpens,
    socialClicks,
  ] = await Promise.all([
    countRows(client, "profile_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "schedule_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "follows", "dancer_id", dancerId, "created_at", since),
    countRows(client, "favorites", "dancer_id", dancerId, "created_at", since),
    countRows(client, "direction_requests", "dancer_id", dancerId, "requested_at", since),
    countGoingSignals(client, dancerId, since),
    countNotificationOpens(client, dancerId, since),
    countRows(client, "social_clicks", "dancer_id", dancerId, "clicked_at", since),
  ]);

  return {
    profileViews,
    scheduleViews,
    followers,
    favorites,
    directionRequests,
    goingSignals,
    notificationOpens,
    socialClicks,
  };
}

async function countRows(
  client: DancrClient,
  table: string,
  idColumn: string,
  idValue: string,
  dateColumn: string,
  since: Date,
) {
  const { count, error } = await (client as any)
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(idColumn, idValue)
    .gte(dateColumn, since.toISOString());

  if (error) throw error;
  return count || 0;
}

async function countTable(client: DancrClient, table: string) {
  const { count, error } = await (client as any)
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) return { ok: false, count: null, error: error.message };
  return { ok: true, count: count || 0 };
}

function integrationStatus(name: string, required: string[]) {
  return {
    name,
    ok: required.every((key) => Boolean(process.env[key])),
    required,
  };
}

async function countGoingSignals(client: DancrClient, dancerId: string, since: Date) {
  const { count, error } = await (client as any)
    .from("going_signals")
    .select("shift_id, shifts!inner(dancer_id)", { count: "exact", head: true })
    .eq("shifts.dancer_id", dancerId)
    .gte("created_at", since.toISOString());

  if (error) throw error;
  return count || 0;
}

async function countNotificationOpens(client: DancrClient, dancerId: string, since: Date) {
  const { count, error } = await (client as any)
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .contains("payload", { dancerId })
    .not("read_at", "is", null)
    .gte("created_at", since.toISOString());

  if (error) throw error;
  return count || 0;
}

function calculateTrendingScore(metrics: TrendingMetricCounts) {
  return (
    metrics.profileViews * 1 +
    metrics.scheduleViews * 2 +
    metrics.followers * 7 +
    metrics.favorites * 6 +
    metrics.directionRequests * 8 +
    metrics.goingSignals * 9 +
    metrics.notificationOpens * 5 +
    metrics.socialClicks * 3
  );
}

function getRankTrend(previousRank: number | null, rank: number) {
  if (!previousRank) return "new";
  if (previousRank > rank) return "rising";
  if (previousRank < rank) return "falling";
  return "stable";
}

function getRankingMilestone(dancer: any, city: string, oldRank: number | null, newRank: number) {
  const milestone = getMilestoneType(oldRank, newRank);
  if (!milestone) return null;

  const message = getMilestoneMessage(dancer.stage_name, city, oldRank, newRank, milestone);

  return {
    dancer_id: dancer.id,
    userId: dancer.user_id,
    city,
    event_type: milestone,
    old_rank: oldRank,
    new_rank: newRank,
    message,
    notified_at: new Date().toISOString(),
  };
}

function getBiggestMoverMilestone(scored: Array<{ dancer: any; previousRank: number | null }>, city: string) {
  const biggestMover = scored
    .map((entry, index) => ({
      dancer: entry.dancer,
      oldRank: entry.previousRank,
      newRank: index + 1,
      movement: entry.previousRank ? entry.previousRank - (index + 1) : 0,
    }))
    .filter((entry) => entry.movement > 0)
    .sort((a, b) => b.movement - a.movement || a.newRank - b.newRank)[0];

  if (!biggestMover) return null;

  return {
    dancer_id: biggestMover.dancer.id,
    userId: biggestMover.dancer.user_id,
    city,
    event_type: "biggest_mover",
    old_rank: biggestMover.oldRank,
    new_rank: biggestMover.newRank,
    message: getMilestoneMessage(
      biggestMover.dancer.stage_name,
      city,
      biggestMover.oldRank,
      biggestMover.newRank,
      "biggest_mover",
    ),
    notified_at: new Date().toISOString(),
  };
}

function getMilestoneType(oldRank: number | null, newRank: number) {
  if (newRank === 1 && oldRank !== 1) return "number_one";
  if (newRank <= 10 && (!oldRank || oldRank > 10)) return "entered_top_10";
  if (!oldRank) return "first_time_trending";
  if (oldRank - newRank >= 3) return "moved_up_3_plus";
  return null;
}

function getMilestoneMessage(stageName: string, city: string, oldRank: number | null, newRank: number, milestone: string) {
  if (milestone === "number_one") return `${stageName} reached #1 Trending in ${city}.`;
  if (milestone === "entered_top_10") return `${stageName} entered the Top 10 Trending in ${city}.`;
  if (milestone === "moved_up_3_plus") return `${stageName} moved from #${oldRank} to #${newRank} Trending in ${city}.`;
  if (milestone === "biggest_mover") return `${stageName} is the biggest mover in ${city}, climbing from #${oldRank} to #${newRank}.`;
  return `${stageName} is now #${newRank} Trending in ${city}.`;
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

function toDancerPhotoUrl(client: DancrClient, storagePath: string) {
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  return client.storage.from("dancer-photos").getPublicUrl(storagePath).data.publicUrl;
}

async function assertAllSubmittedContentReviewed(client: DancrClient, dancer: { id: string; user_id: string }) {
  const db = client as any;
  const { data: reviews, error: reviewsError } = await db
    .from("approval_reviews")
    .select("review_type, status, notes, created_at, reviewed_at")
    .eq("dancer_id", dancer.id);

  if (reviewsError) throw reviewsError;

  const reviewRows = reviews || [];
  const documents = await listVerificationDocumentsForUser(client, dancer.user_id, reviewRows);
  const pendingRequiredDocuments = requiredVerificationDocuments()
    .filter((required) => !documents.some((document: any, index: number) =>
      matchesRequiredVerificationDocument(document, required, index) && document.status === "approved"
    ));

  if (pendingRequiredDocuments.length) {
    throw new Error(`Approve required verification first: ${pendingRequiredDocuments.map((item) => item.label).join(", ")}.`);
  }
}

function requiredVerificationDocuments() {
  return [
    { key: "government_id", label: "Government ID", terms: ["government", "id"], fallbackIndex: 0 },
    { key: "selfie", label: "Selfie verification", terms: ["selfie"], fallbackIndex: 1 },
    { key: "dance_proof", label: "Proof that they dance", terms: ["proof", "dance"], fallbackIndex: 2 },
  ];
}

function matchesRequiredVerificationDocument(
  document: { documentType?: string; displayName?: string; name?: string },
  required: { key: string; terms: string[]; fallbackIndex: number },
  index: number,
) {
  const text = [document.documentType, document.displayName, document.name].filter(Boolean).join(" ").toLowerCase();
  if (text.includes(required.key)) return true;
  if (required.terms.every((term) => text.includes(term))) return true;
  return !text.trim() && index === required.fallbackIndex;
}

async function listVerificationDocumentsForUser(client: DancrClient, userId: string, reviews: any[] = []) {
  if (!userId) return [];

  const prefix = `${userId}/verification`;
  const bucket = client.storage.from("verification-documents");
  const { data, error } = await bucket.list(prefix, {
    limit: 50,
    offset: 0,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) return [];

  return Promise.all(
    (data || [])
      .filter((document: any) => Boolean(document.name))
      .map(async (document: any, index: number) => {
        const storagePath = `${prefix}/${document.name}`;
        const { data: signedData } = await bucket.createSignedUrl(storagePath, 60 * 60);
        const publicUrl = bucket.getPublicUrl(storagePath).data.publicUrl;
        const review = latestReviewFor(reviews, contentReviewType("verification_document", storagePath));
        const display = verificationDocumentDisplay(document.name, index);

        return {
          name: document.name,
          documentType: display.documentType,
          displayName: display.displayName,
          storagePath,
          fileUrl: signedData?.signedUrl || publicUrl,
          status: review?.status || ("pending_review" as const),
          reviewNotes: review?.notes || null,
          reviewedAt: review?.reviewed_at || null,
          createdAt: document.created_at || document.updated_at || null,
          updatedAt: document.updated_at || null,
        };
      }),
  );
}

async function updatePhotoReviewSummary(client: DancrClient, dancerId: string) {
  const db = client as any;
  const { data, error } = await db.from("dancer_photos").select("review_status").eq("dancer_id", dancerId);
  if (error) throw error;

  const status = aggregateReviewStatus((data || []).map((row: any) => row.review_status));
  const { error: updateError } = await db.from("dancer_profiles").update({ photo_review_status: status }).eq("id", dancerId);
  if (updateError) throw updateError;
}

async function updateVerificationReviewSummary(client: DancrClient, userId: string, dancerId: string) {
  const db = client as any;
  const [reviewsResult, accountResult, profileResult] = await Promise.all([
    db
      .from("approval_reviews")
      .select("review_type, status, notes, created_at, reviewed_at")
      .eq("dancer_id", dancerId),
    db
      .from("app_users")
      .select("account_state")
      .eq("id", userId)
      .maybeSingle(),
    db
      .from("dancer_profiles")
      .select("status, approved_at, disabled_at")
      .eq("id", dancerId)
      .maybeSingle(),
  ]);

  if (reviewsResult.error) throw reviewsResult.error;
  if (accountResult.error) throw accountResult.error;
  if (profileResult.error) throw profileResult.error;
  if (!profileResult.data) throw new Error("Dancer profile not found.");

  const documents = await listVerificationDocumentsForUser(client, userId, reviewsResult.data || []);
  const statuses = requiredVerificationDocuments().map((required) => {
    const document = documents.find((item: any, index: number) => matchesRequiredVerificationDocument(item, required, index));
    return document ? (document.status === "pending_review" ? "pending" : document.status) : "pending";
  });
  const status = aggregateReviewStatus(statuses);
  const accountIsActive = accountResult.data?.account_state === "active";
  const profileIsDisabled = Boolean(profileResult.data.disabled_at);
  const profileUpdate: Record<string, string | null> = { verification_status: status };

  if (!accountIsActive || profileIsDisabled) {
    profileUpdate.status = "disabled";
  } else if (status === "approved") {
    profileUpdate.status = "approved";
    profileUpdate.approved_at = profileResult.data.approved_at || new Date().toISOString();
  } else if (status === "rejected") {
    profileUpdate.status = "rejected";
    profileUpdate.approved_at = null;
  } else if (profileResult.data.status !== "rejected") {
    profileUpdate.status = "pending_review";
    profileUpdate.approved_at = null;
  }

  const { error: updateError } = await db.from("dancer_profiles").update(profileUpdate).eq("id", dancerId);
  if (updateError) throw updateError;
}

function aggregateReviewStatus(statuses: string[]) {
  if (!statuses.length) return "pending";
  if (statuses.some((status) => status === "rejected")) return "rejected";
  if (statuses.every((status) => status === "approved")) return "approved";
  return "pending";
}

function isFinalReviewStatus(status: string | null | undefined) {
  return status === "approved" || status === "rejected";
}

function contentReviewType(targetType: ReviewSubmissionContentInput["targetType"], targetId: string) {
  return `${targetType}:${targetId}`;
}

function latestReviewFor(reviews: any[], reviewType: string) {
  return (reviews || [])
    .filter((review) => review.review_type === reviewType || review.reviewType === reviewType)
    .sort((a, b) => Date.parse(b.reviewed_at || b.reviewedAt || b.created_at || b.createdAt || "") - Date.parse(a.reviewed_at || a.reviewedAt || a.created_at || a.createdAt || ""))[0];
}

function verificationDocumentDisplay(name: string, index: number) {
  const normalized = name.toLowerCase();
  if (normalized.includes("selfie")) return { documentType: "selfie", displayName: "Selfie verification" };
  if (normalized.includes("proof") || normalized.includes("dance")) return { documentType: "dance_proof", displayName: "Proof that they dance" };
  if (normalized.includes("id") || normalized.includes("license") || normalized.includes("passport")) {
    return { documentType: "government_id", displayName: "Government ID" };
  }

  const fallback = ["Government ID", "Selfie verification", "Proof that they dance"][index];
  return { documentType: fallback ? slugify(fallback) : "verification_file", displayName: fallback || "Verification file" };
}
