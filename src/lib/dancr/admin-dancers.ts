import type { SupabaseClient } from "@supabase/supabase-js";
import { responsivePublicImage } from "./responsive-image";
import { transitionDancerPublication } from "./profile-publication";

type DancrClient = SupabaseClient;

export const ADMIN_DANCER_STATUSES = [
  "all",
  "needs_action",
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "disabled",
] as const;
export const ADMIN_DANCER_SCHEDULES = ["all", "working_now", "upcoming", "no_schedule"] as const;
export const ADMIN_DANCER_MODERATION = ["all", "pending", "clear"] as const;
export const ADMIN_DANCER_COMMISSIONS = ["all", "active", "not_active"] as const;
export const ADMIN_DANCER_SOURCES = ["all", "demo", "standard"] as const;
export const ADMIN_DANCER_SORTS = ["updated", "created", "name", "status"] as const;

export type AdminDancerRosterQuery = {
  q: string;
  status: typeof ADMIN_DANCER_STATUSES[number];
  schedule: typeof ADMIN_DANCER_SCHEDULES[number];
  moderation: typeof ADMIN_DANCER_MODERATION[number];
  commission: typeof ADMIN_DANCER_COMMISSIONS[number];
  source: typeof ADMIN_DANCER_SOURCES[number];
  city: string;
  venueId: string;
  sort: typeof ADMIN_DANCER_SORTS[number];
  page: number;
  pageSize: number;
};

export type AdminDancerRosterItem = {
  id: string;
  userId: string;
  stageName: string;
  slug: string;
  city: string;
  status: string;
  isPublic: boolean;
  accountState: string;
  email: string | null;
  avatarUrl: string | null;
  avatarSrcSet: string | null;
  photoReviewStatus: string;
  media: { approved: number; pending: number; rejected: number; videos: number };
  schedule: { state: "working_now" | "upcoming" | "no_schedule"; startsAt: string | null; endsAt: string | null; source: string | null };
  venue: { id: string; name: string; slug: string } | null;
  affiliationCount: number;
  commissionStatus: "active" | "requested" | "disabled" | "not_linked";
  openReports: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
};

export type AdminDancerRosterResult = {
  items: AdminDancerRosterItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filters: {
    cities: string[];
    venues: Array<{ id: string; name: string; city: string }>;
  };
};

export function parseAdminDancerRosterQuery(url: string): AdminDancerRosterQuery {
  const params = new URL(url).searchParams;
  return {
    q: cleanText(params.get("q"), 100),
    status: enumValue(params.get("status"), ADMIN_DANCER_STATUSES, "all"),
    schedule: enumValue(params.get("schedule"), ADMIN_DANCER_SCHEDULES, "all"),
    moderation: enumValue(params.get("moderation"), ADMIN_DANCER_MODERATION, "all"),
    commission: enumValue(params.get("commission"), ADMIN_DANCER_COMMISSIONS, "all"),
    source: enumValue(params.get("source"), ADMIN_DANCER_SOURCES, "all"),
    city: cleanText(params.get("city"), 80),
    venueId: cleanUuid(params.get("venueId")),
    sort: enumValue(params.get("sort"), ADMIN_DANCER_SORTS, "updated"),
    page: boundedInteger(params.get("page"), 1, 1, 10_000),
    pageSize: boundedInteger(params.get("pageSize"), 20, 10, 50),
  };
}

export async function getAdminDancerRoster(
  client: DancrClient,
  input: AdminDancerRosterQuery,
): Promise<AdminDancerRosterResult> {
  const db = client as any;
  const now = new Date().toISOString();
  const [futureShiftResult, affiliationResult, videoResult, affiliateResult, cityResult, venueResult] = await Promise.all([
    db.from("shifts").select("dancer_id, venue_id, starts_at, ends_at, status, shift_source, updated_at").eq("status", "posted").gt("ends_at", now),
    db.from("venue_dancer_affiliations").select("dancer_id, venue_id, status, updated_at").eq("status", "active"),
    db.from("mydancr_tv_videos").select("dancer_id, status, updated_at"),
    db.from("nats_affiliate_accounts").select("dancer_id, status, updated_at"),
    db.from("dancer_profiles").select("city").order("city", { ascending: true }).limit(5000),
    db.from("venues").select("id, name, city").eq("is_active", true).order("city").order("name"),
  ]);
  throwIfError(futureShiftResult.error);
  throwIfError(affiliationResult.error);
  throwIfError(videoResult.error);
  throwIfError(affiliateResult.error);
  throwIfError(cityResult.error);
  throwIfError(venueResult.error);

  const futureShifts = futureShiftResult.data || [];
  const affiliations = affiliationResult.data || [];
  const videos = videoResult.data || [];
  const affiliates = affiliateResult.data || [];
  let requiredIds: Set<string> | null = null;
  const excludedIds = new Set<string>();

  if (input.schedule !== "all") {
    const scheduledIds = new Set<string>();
    for (const shift of futureShifts) {
      const working = shift.starts_at <= now && shift.ends_at > now;
      const upcoming = shift.starts_at > now;
      if ((input.schedule === "working_now" && working) || (input.schedule === "upcoming" && upcoming)) {
        scheduledIds.add(shift.dancer_id);
      }
      if (input.schedule === "no_schedule") excludedIds.add(shift.dancer_id);
    }
    if (input.schedule !== "no_schedule") requiredIds = intersectRequired(requiredIds, scheduledIds);
  }

  if (input.venueId) {
    const venueIds = new Set<string>(
      affiliations.filter((row: any) => row.venue_id === input.venueId).map((row: any) => row.dancer_id),
    );
    requiredIds = intersectRequired(requiredIds, venueIds);
  }

  const activeAffiliateIds = new Set<string>(
    affiliates.filter((row: any) => row.status === "active").map((row: any) => row.dancer_id),
  );
  if (input.commission === "active") requiredIds = intersectRequired(requiredIds, activeAffiliateIds);
  if (input.commission === "not_active") activeAffiliateIds.forEach((id) => excludedIds.add(id));

  const demoIds = new Set<string>(
    futureShifts.filter((row: any) => row.shift_source === "demo_locked").map((row: any) => row.dancer_id),
  );
  if (input.source === "demo") requiredIds = intersectRequired(requiredIds, demoIds);
  if (input.source === "standard") demoIds.forEach((id) => excludedIds.add(id));

  if (input.moderation === "pending") {
    const pendingCore = await db
      .from("dancer_profiles")
      .select("id")
      .or("status.in.(draft,pending_review),photo_review_status.eq.pending");
    throwIfError(pendingCore.error);
    const pendingIds = new Set<string>((pendingCore.data || []).map((row: any) => row.id));
    videos.filter((row: any) => ["uploading", "moderating", "submitted"].includes(row.status)).forEach((row: any) => pendingIds.add(row.dancer_id));
    requiredIds = intersectRequired(requiredIds, pendingIds);
  }

  if (input.q) {
    const pattern = `%${input.q.replace(/[%_,().]/g, " ")}%`;
    const [profileMatches, accountMatches] = await Promise.all([
      db.from("dancer_profiles").select("id").or(`stage_name.ilike.${pattern},slug.ilike.${pattern},city.ilike.${pattern}`),
      db.from("app_users").select("id").or(`email.ilike.${pattern},display_name.ilike.${pattern}`).eq("role", "dancer"),
    ]);
    throwIfError(profileMatches.error);
    throwIfError(accountMatches.error);
    const matchedIds = new Set<string>((profileMatches.data || []).map((row: any) => row.id));
    const matchedUserIds = (accountMatches.data || []).map((row: any) => row.id);
    if (matchedUserIds.length) {
      const accountProfiles = await db.from("dancer_profiles").select("id").in("user_id", matchedUserIds);
      throwIfError(accountProfiles.error);
      (accountProfiles.data || []).forEach((row: any) => matchedIds.add(row.id));
    }
    requiredIds = intersectRequired(requiredIds, matchedIds);
  }

  if (requiredIds && !requiredIds.size) {
    return emptyRoster(input, cityResult.data, venueResult.data);
  }

  let query = db
    .from("dancer_profiles")
    .select("id, user_id, stage_name, slug, city, status, is_public, verification_status, photo_review_status, avatar_storage_path, approved_at, disabled_at, created_at, updated_at", { count: "exact" });
  if (input.city) query = query.eq("city", input.city);
  if (["draft", "pending_review", "approved", "rejected", "disabled"].includes(input.status)) query = query.eq("status", input.status);
  if (input.status === "needs_action") query = query.or("status.in.(draft,pending_review,rejected),photo_review_status.eq.pending");
  if (input.moderation === "clear") query = query.not("photo_review_status", "eq", "pending").not("status", "in", "(draft,pending_review)");
  if (requiredIds) query = query.in("id", [...requiredIds]);
  if (excludedIds.size) query = query.not("id", "in", `(${[...excludedIds].join(",")})`);

  const sortColumns = { updated: "updated_at", created: "created_at", name: "stage_name", status: "status" } as const;
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;
  const { data: profiles, error, count } = await query
    .order(sortColumns[input.sort], { ascending: input.sort === "name" })
    .order("id", { ascending: true })
    .range(from, to);
  throwIfError(error);

  const pageProfiles = profiles || [];
  const items = await hydrateRosterItems(client, pageProfiles, futureShifts, affiliations, videos, affiliates, demoIds);
  const total = Number(count || 0);
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    filters: filterOptions(cityResult.data, venueResult.data),
  };
}

export async function getAdminDancerOperationalDetail(client: DancrClient, dancerId: string) {
  const db = client as any;
  const now = new Date().toISOString();
  const [affiliations, shifts, videos, affiliate, commissions, reports, actions, followers, views, directions] = await Promise.all([
    db.from("venue_dancer_affiliations").select("id, status, approved_at, revoked_at, revoke_reason, venue_id, venues(id, name, slug, city)").eq("dancer_id", dancerId).order("updated_at", { ascending: false }),
    db.from("shifts").select("id, venue_id, starts_at, ends_at, status, shift_source, checked_in_at, checked_out_at, venues(id, name, slug)").eq("dancer_id", dancerId).order("starts_at", { ascending: false }).limit(50),
    db.from("mydancr_tv_videos").select("id, status, venue_id, duration_seconds, published_at, created_at, updated_at").eq("dancer_id", dancerId).order("created_at", { ascending: false }).limit(50),
    db.from("nats_affiliate_accounts").select("status, username, requested_at, activated_at, disabled_at, last_error").eq("dancer_id", dancerId).maybeSingle(),
    db.from("commission_events").select("id, status, amount_cents, currency, created_at, payable_at, paid_at").eq("dancer_id", dancerId).order("created_at", { ascending: false }).limit(50),
    db.from("content_reports").select("id, reason, details, status, created_at, reviewed_at").eq("target_id", dancerId).order("created_at", { ascending: false }).limit(50),
    db.from("admin_actions").select("id, action, notes, created_at, admin_id").eq("target_id", dancerId).order("created_at", { ascending: false }).limit(50),
    db.from("follows").select("dancer_id", { count: "exact", head: true }).eq("dancer_id", dancerId),
    db.from("profile_views").select("id", { count: "exact", head: true }).eq("dancer_id", dancerId),
    db.from("direction_requests").select("id", { count: "exact", head: true }).eq("dancer_id", dancerId),
  ]);
  [affiliations, shifts, videos, commissions, reports, actions, followers, views, directions].forEach((result) => throwIfError(result.error));
  if (affiliate.error && affiliate.error.code !== "PGRST116") throw affiliate.error;

  return {
    affiliations: affiliations.data || [],
    shifts: shifts.data || [],
    videos: videos.data || [],
    natsAccount: affiliate.data || null,
    commissions: commissions.data || [],
    reports: reports.data || [],
    accountHistory: actions.data || [],
    analytics: {
      followers: Number(followers.count || 0),
      profileViews: Number(views.count || 0),
      directionRequests: Number(directions.count || 0),
      activeShifts: (shifts.data || []).filter((row: any) => row.status === "posted" && row.ends_at > now).length,
      totalCommissionCents: (commissions.data || []).filter((row: any) => ["available", "payable", "paid"].includes(row.status)).reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0),
    },
  };
}

export async function updateAdminDancerLifecycle(
  client: DancrClient,
  input: { dancerId: string; adminId: string; action: "disable" | "reactivate"; reason: string },
) {
  if (input.reason.trim().length < 4 || input.reason.trim().length > 500) {
    throw new Error("Add a reason between 4 and 500 characters.");
  }
  const state = await transitionDancerPublication(client, input.dancerId, input.action, { actorUserId: input.adminId });
  const { error } = await (client as any).from("admin_actions").insert({
    admin_id: input.adminId,
    target_type: "dancer_profile",
    target_id: input.dancerId,
    action: input.action === "disable" ? "disable_dancer_profile" : "reactivate_dancer_profile",
    notes: input.reason.trim(),
  });
  if (error) throw error;
  return state;
}

async function hydrateRosterItems(client: DancrClient, profiles: any[], futureShifts: any[], allAffiliations: any[], allVideos: any[], allAffiliates: any[], demoIds: Set<string>) {
  if (!profiles.length) return [];
  const db = client as any;
  const ids = profiles.map((row) => row.id);
  const userIds = profiles.map((row) => row.user_id);
  const venueIds = [...new Set([
    ...futureShifts.filter((row) => ids.includes(row.dancer_id)).map((row) => row.venue_id),
    ...allAffiliations.filter((row) => ids.includes(row.dancer_id)).map((row) => row.venue_id),
  ])];
  const [accounts, photos, reports, venues] = await Promise.all([
    db.from("app_users").select("id, email, account_state, updated_at").in("id", userIds),
    db.from("dancer_photos").select("dancer_id, storage_path, is_primary, review_status, sort_order, created_at").in("dancer_id", ids).order("sort_order"),
    db.from("content_reports").select("target_id, status, created_at").in("target_id", ids).eq("status", "open"),
    venueIds.length ? db.from("venues").select("id, name, slug").in("id", venueIds) : Promise.resolve({ data: [], error: null }),
  ]);
  [accounts, photos, reports, venues].forEach((result) => throwIfError(result.error));
  const venueById = new Map((venues.data || []).map((row: any) => [row.id, row]));
  const now = new Date().toISOString();

  return profiles.map((profile) => {
    const account = (accounts.data || []).find((row: any) => row.id === profile.user_id);
    const photosForDancer = (photos.data || []).filter((row: any) => row.dancer_id === profile.id);
    const shifts = futureShifts.filter((row) => row.dancer_id === profile.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const working = shifts.find((row) => row.starts_at <= now && row.ends_at > now);
    const next = working || shifts.find((row) => row.starts_at > now) || null;
    const affiliations = allAffiliations.filter((row) => row.dancer_id === profile.id);
    const affiliation = next ? affiliations.find((row) => row.venue_id === next.venue_id) || affiliations[0] : affiliations[0];
    const venueId = next?.venue_id || affiliation?.venue_id || "";
    const venue = venueById.get(venueId) as any;
    const dancerVideos = allVideos.filter((row) => row.dancer_id === profile.id);
    const affiliate = allAffiliates.find((row) => row.dancer_id === profile.id);
    const avatarPath = profile.avatar_storage_path || photosForDancer.find((row: any) => row.is_primary)?.storage_path || photosForDancer[0]?.storage_path;
    const avatar = responsivePublicImage(client as any, "dancer-photos", avatarPath);
    const activityDates = [profile.updated_at, account?.updated_at, next?.updated_at, affiliation?.updated_at, ...dancerVideos.map((row) => row.updated_at)].filter(Boolean).sort().reverse();
    return {
      id: profile.id,
      userId: profile.user_id,
      stageName: profile.stage_name,
      slug: profile.slug,
      city: profile.city,
      status: profile.status,
      isPublic: profile.is_public === true,
      accountState: account?.account_state || "unknown",
      email: account?.email || null,
      avatarUrl: avatar?.imageUrl || null,
      avatarSrcSet: avatar?.imageSrcSet || null,
      photoReviewStatus: profile.photo_review_status,
      media: {
        approved: photosForDancer.filter((row: any) => row.review_status === "approved").length,
        pending: photosForDancer.filter((row: any) => row.review_status === "pending").length + dancerVideos.filter((row: any) => ["uploading", "moderating", "submitted"].includes(row.status)).length,
        rejected: photosForDancer.filter((row: any) => row.review_status === "rejected").length + dancerVideos.filter((row: any) => row.status === "rejected").length,
        videos: dancerVideos.length,
      },
      schedule: { state: working ? "working_now" : next ? "upcoming" : "no_schedule", startsAt: next?.starts_at || null, endsAt: next?.ends_at || null, source: next?.shift_source || null },
      venue: venue ? { id: venue.id, name: venue.name, slug: venue.slug } : null,
      affiliationCount: affiliations.length,
      commissionStatus: affiliate?.status || "not_linked",
      openReports: (reports.data || []).filter((row: any) => row.target_id === profile.id).length,
      isDemo: demoIds.has(profile.id),
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
      lastActivityAt: activityDates[0] || profile.created_at,
    } satisfies AdminDancerRosterItem;
  });
}

function intersectRequired(current: Set<string> | null, next: Set<string>) {
  return current ? new Set([...current].filter((id) => next.has(id))) : next;
}

function cleanText(value: string | null, max: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanUuid(value: string | null) {
  const normalized = cleanText(value, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized) ? normalized : "";
}

function enumValue<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return allowed.includes(String(value) as T[number]) ? String(value) as T[number] : fallback;
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function throwIfError(error: any) {
  if (error) throw error;
}

function filterOptions(cities: any[] = [], venues: any[] = []) {
  return {
    cities: [...new Set<string>(cities.map((row) => String(row.city || "").trim()).filter(Boolean))],
    venues: venues.map((row) => ({ id: row.id, name: row.name, city: row.city })),
  };
}

function emptyRoster(input: AdminDancerRosterQuery, cities: any[] = [], venues: any[] = []): AdminDancerRosterResult {
  return { items: [], page: input.page, pageSize: input.pageSize, total: 0, totalPages: 1, filters: filterOptions(cities, venues) };
}
