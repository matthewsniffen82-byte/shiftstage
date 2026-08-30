import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerCard, DancerProfile, ShiftSummary, SocialPlatform, VenueSummary } from "./types";
import { isPublicDancerProfileEligible } from "./profile-approval";
import { responsivePublicImage } from "./responsive-image";
import { safeSocialProfileUrl, socialProfileHandle } from "./social-profile-url";
import { verifiedVenueLogoUrl } from "./venue-branding";
import { isActiveNfcPresence } from "./shift-presence";

type DancrClient = SupabaseClient;

const PUBLIC_DANCER_DIRECTORY_LIMIT = 200;
const PUBLIC_PROFILE_MEDIA_LIMIT = 50;
const PUBLIC_PROFILE_SHIFT_LIMIT = 50;

function applyPublicApprovalFilters(query: any) {
  return query
    .eq("status", "approved")
    .eq("verification_status", "approved")
    .is("disabled_at", null);
}

function isMissingIsPublicColumnError(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && message.includes("is_public");
}

export function isApprovedPublicDancerRow(dancer: any) {
  return isPublicDancerProfileEligible(dancer);
}

export async function getApprovedDancersByCity(client: DancrClient, city: string): Promise<DancerCard[]> {
  const rows = await getApprovedDancerRowsByCity(client, city);
  return toDancerCards(client, rows);
}

export async function getLiveDancerDiscovery(
  client: DancrClient,
  city: string,
): Promise<{ dancers: DancerCard[]; tonightDancers: DancerCard[] }> {
  const rows = await getApprovedDancerRowsByCity(client, city);
  const dancers = rows.map((row) => buildDancerCard(client, row).card);
  const now = Date.now();
  const tonightDancers = rows
    .map((row) => buildDancerCard(client, row, { checkedInOnly: true }).card)
    .filter((card) => {
      return Boolean(
        card.shiftId &&
        card.locationStatus === "club_confirmed" &&
        new Date(card.locationVerificationExpiresAt || "").getTime() > now
      );
    });
  const hydratedCards = await hydrateDancerCardMetrics(client, [...dancers, ...tonightDancers]);

  return {
    dancers: hydratedCards.slice(0, dancers.length),
    tonightDancers: hydratedCards.slice(dancers.length),
  };
}

async function getApprovedDancerRowsByCity(client: DancrClient, city: string): Promise<any[]> {
  const cityName = city.trim();
  const current = await applyPublicApprovalFilters(client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        status,
        approved_at,
        disabled_at,
        verification_status,
        venue_approved_at,
        photo_review_status,
        avatar_storage_path,
        is_public,
        trending_scores(rank),
        dancer_photos(id, storage_path, is_primary, review_status, sort_order, like_count),
        social_links(id, platform, handle, url, is_active),
        shifts(id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venue_id, venues(id, name, slug, timezone, is_active))
      `,
    )
    .ilike("city", cityName))
    .eq("is_public", true)
    .order("stage_name", { ascending: true })
    .order("starts_at", { referencedTable: "shifts", ascending: true })
    .limit(PUBLIC_DANCER_DIRECTORY_LIMIT);

  let data: any[] | null = current.data as any[] | null;
  let error: any = current.error;
  if (isMissingIsPublicColumnError(error)) {
    console.warn("PUBLIC_DANCERS_VISIBILITY_COLUMN_MISSING", { city: cityName, code: error.code });
    const legacy = await applyPublicApprovalFilters(client
      .from("dancer_profiles")
      .select(
        `
          id,
          slug,
          stage_name,
          city,
          status,
          approved_at,
          disabled_at,
          verification_status,
          venue_approved_at,
          photo_review_status,
          avatar_storage_path,
          trending_scores(rank),
          dancer_photos(id, storage_path, is_primary, review_status, sort_order, like_count),
          social_links(id, platform, handle, url, is_active),
          shifts(id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venue_id, venues(id, name, slug, timezone, is_active))
        `,
      )
      .ilike("city", cityName))
      .order("stage_name", { ascending: true })
      .order("starts_at", { referencedTable: "shifts", ascending: true })
      .limit(PUBLIC_DANCER_DIRECTORY_LIMIT);
    data = legacy.data as any[] | null;
    error = legacy.error;
  }

  if (error) throw error;

  const rows = (data || []).filter(isApprovedPublicDancerRow);
  console.log("PUBLIC_DANCERS_QUERY_RESULT", {
    city: cityName,
    rawCount: data?.length || 0,
    publicApprovedCount: rows.length,
  });

  return rows;
}

export async function getTonightShifts(client: DancrClient, city: string, now = new Date()): Promise<DancerCard[]> {
  const cityName = city.trim();
  const current = await applyPublicApprovalFilters(client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        status,
        approved_at,
        disabled_at,
        verification_status,
        venue_approved_at,
        photo_review_status,
        avatar_storage_path,
        is_public,
        trending_scores(rank),
        dancer_photos(id, storage_path, is_primary, review_status, sort_order, like_count),
        social_links(id, platform, handle, url, is_active),
        shifts!inner(id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venue_id, venues(id, name, slug, timezone, is_active))
      `,
    )
    .ilike("city", cityName))
    .eq("is_public", true)
    .eq("shifts.status", "posted")
    .not("shifts.checked_in_at", "is", null)
    .is("shifts.checked_out_at", null)
    .eq("shifts.location_status", "club_confirmed")
    .gt("shifts.location_verification_expires_at", now.toISOString())
    .order("starts_at", { referencedTable: "shifts", ascending: true })
    .limit(PUBLIC_DANCER_DIRECTORY_LIMIT);

  let data: any[] | null = current.data as any[] | null;
  let error: any = current.error;
  if (isMissingIsPublicColumnError(error)) {
    console.warn("PUBLIC_SHIFTS_VISIBILITY_COLUMN_MISSING", { city: cityName, code: error.code });
    const legacy = await applyPublicApprovalFilters(client
      .from("dancer_profiles")
      .select(
        `
          id,
          slug,
          stage_name,
          city,
          status,
          approved_at,
          disabled_at,
          verification_status,
          venue_approved_at,
          photo_review_status,
          avatar_storage_path,
          trending_scores(rank),
          dancer_photos(id, storage_path, is_primary, review_status, sort_order, like_count),
          social_links(id, platform, handle, url, is_active),
          shifts!inner(id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venue_id, venues(id, name, slug, timezone, is_active))
        `,
      )
      .ilike("city", cityName))
      .eq("shifts.status", "posted")
      .not("shifts.checked_in_at", "is", null)
      .is("shifts.checked_out_at", null)
      .eq("shifts.location_status", "club_confirmed")
      .gt("shifts.location_verification_expires_at", now.toISOString())
      .order("starts_at", { referencedTable: "shifts", ascending: true })
      .limit(PUBLIC_DANCER_DIRECTORY_LIMIT);
    data = legacy.data as any[] | null;
    error = legacy.error;
  }

  if (error) throw error;

  const rows = (data || []).filter(isApprovedPublicDancerRow);
  const cards = await toDancerCards(client, rows, { checkedInOnly: true });
  return cards.filter((card) => card.shiftId && card.locationStatus !== "self_reported");
}

export async function getDancerProfile(client: DancrClient, slug: string): Promise<DancerProfile | null> {
  const current = await applyPublicApprovalFilters(client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        status,
        approved_at,
        disabled_at,
        verification_status,
        venue_approved_at,
        photo_review_status,
        avatar_storage_path,
        is_public,
        trending_scores(rank),
        social_links(id, platform, handle, url, is_active),
        shifts(id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venues(id, name, slug, timezone, is_active))
      `,
    )
    .eq("slug", slug))
    .eq("is_public", true)
    .limit(PUBLIC_PROFILE_SHIFT_LIMIT, { referencedTable: "shifts" })
    .maybeSingle();

  let data: any = current.data;
  let error: any = current.error;
  if (isMissingIsPublicColumnError(error)) {
    console.warn("PUBLIC_DANCER_PROFILE_VISIBILITY_COLUMN_MISSING", { slug, code: error.code });
    const legacy = await applyPublicApprovalFilters(client
      .from("dancer_profiles")
      .select(
        `
          id,
          slug,
          stage_name,
          city,
          status,
          approved_at,
          disabled_at,
          verification_status,
          venue_approved_at,
          photo_review_status,
          avatar_storage_path,
          trending_scores(rank),
          social_links(id, platform, handle, url, is_active),
          shifts(id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venues(id, name, slug, timezone, is_active))
        `,
      )
      .eq("slug", slug))
      .limit(PUBLIC_PROFILE_SHIFT_LIMIT, { referencedTable: "shifts" })
      .maybeSingle();
    data = legacy.data;
    error = legacy.error;
  }

  if (error) throw error;
  if (!data) return null;

  const row: any = data;
  if (!isApprovedPublicDancerRow(row)) return null;
  const [
    approvedPhotos,
    followerCount,
    notificationCount,
    profileViewsToday,
    goingCount,
  ] = await Promise.all([
    getApprovedDancerPhotos(client, row.id),
    countDancerFollowers(client, row.id),
    countDancerNotificationSubscribers(client, row.id),
    countDancerProfileViewsToday(client, row.id),
    countDancerGoingSignals(client, row.id),
  ]);
  const card = {
    ...buildDancerCard(client, { ...row, dancer_photos: approvedPhotos }).card,
    followerCount,
    notificationCount,
    profileViewsToday,
    goingCount,
  };

  return {
    ...card,
    followerCount: card.followerCount || 0,
    goingCount,
    photos: approvedPhotos.map((photo: any) => {
      const image = responsivePublicImage(
        client,
        "dancer-photos",
        photo.storage_path,
      );
      return {
        id: photo.id,
        likeCount: safeMetricCount(photo.like_count),
        focalX: image?.imageFocalX ?? 50,
        focalY: image?.imageFocalY ?? 50,
        imageUrl: image?.imageUrl || "",
        imageSrcSet: image?.imageSrcSet || null,
        imageWidth: image?.imageWidth || null,
        imageHeight: image?.imageHeight || null,
        isPrimary: photo.is_primary,
        sortOrder: photo.sort_order,
      };
    }),
    socialLinks: (row.social_links || [])
      .filter((link: any) => link.is_active !== false)
      .flatMap(safePublicSocialLink),
    upcomingShifts: (row.shifts || [])
      .filter((shift: any) => shift.status === "posted" && isShiftPubliclyVisible(shift))
      .map(toShiftSummary),
  };
}

async function getApprovedDancerPhotos(client: DancrClient, dancerId: string) {
  const { data, error } = await client
    .from("dancer_photos")
    .select("id, storage_path, is_primary, sort_order, review_status, created_at, like_count")
    .eq("dancer_id", dancerId)
    .eq("review_status", "approved")
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(PUBLIC_PROFILE_MEDIA_LIMIT);

  if (error) throw error;
  return data || [];
}

export async function getVenueProfile(client: DancrClient, slug: string): Promise<VenueSummary | null> {
  const { data, error } = await client
    .from("venues")
    .select("id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at, cover_image_storage_path, logo_storage_path")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const logoImage = responsivePublicImage(client, "venue-logo-images", data.logo_storage_path);
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    city: data.city,
    state: data.state,
    address: data.address,
    latitude: data.latitude,
    longitude: data.longitude,
    hoursLabel: formatVenueHours(data.opens_at, data.closes_at),
    ...venueCoverImageFields(client, data.cover_image_storage_path),
    logoImageUrl: logoImage?.imageUrl || verifiedVenueLogoUrl(data.slug),
    logoImageSrcSet: logoImage?.imageSrcSet || null,
    logoImageWidth: logoImage?.imageWidth || null,
    logoImageHeight: logoImage?.imageHeight || null,
  };
}

export async function getUpcomingShiftsForDancer(client: DancrClient, dancerId: string): Promise<ShiftSummary[]> {
  const { data, error } = await client
    .from("shifts")
    .select("id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venue_id, venues(id, name, slug, timezone, is_active)")
    .eq("dancer_id", dancerId)
    .eq("status", "posted")
    .eq("shift_source", "scheduled")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(PUBLIC_PROFILE_SHIFT_LIMIT);

  if (error) throw error;

  return (data || []).filter((shift: any) => isShiftPubliclyVisible(shift)).map(toShiftSummary);
}

async function countDancerFollowers(client: DancrClient, dancerId: string): Promise<number> {
  const { count, error } = await client
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("dancer_id", dancerId);

  if (error) throw error;
  return count || 0;
}

async function countDancerNotificationSubscribers(client: DancrClient, dancerId: string): Promise<number> {
  const { count, error } = await client
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("dancer_id", dancerId)
    .eq("notifications_enabled", true);

  if (error) throw error;
  return count || 0;
}

async function countDancerProfileViewsToday(client: DancrClient, dancerId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count, error } = await client
    .from("profile_views")
    .select("*", { count: "exact", head: true })
    .eq("dancer_id", dancerId)
    .gte("viewed_at", today.toISOString());

  if (error) throw error;
  return count || 0;
}

async function countDancerGoingSignals(client: DancrClient, dancerId: string): Promise<number> {
  const { count, error } = await client
    .from("going_signals")
    .select("shift_id, shifts!inner(dancer_id, status, ends_at)", { count: "exact", head: true })
    .eq("shifts.dancer_id", dancerId)
    .eq("shifts.status", "posted")
    .gt("shifts.ends_at", new Date().toISOString());

  if (error) throw error;
  return count || 0;
}

type DancerCardOptions = { checkedInOnly?: boolean };

function buildDancerCard(
  client: DancrClient,
  row: any,
  options: DancerCardOptions = {},
): { card: DancerCard; shift: any | null } {
  const shifts = Array.isArray(row.shifts) ? row.shifts : row.shifts ? [row.shifts] : [];
  const now = Date.now();
  const postedShifts = shifts.filter((item: any) => item.status === "posted");
  const visibleShifts = postedShifts
    .filter((item: any) => isShiftPubliclyVisible(item, now))
    .filter(
      (item: any) =>
        !options.checkedInOnly ||
        isActiveNfcPresence(item, now),
    )
    .sort((left: any, right: any) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const liveShift = visibleShifts.find((item: any) => isActiveNfcPresence(item, now));
  const upcomingShift = visibleShifts.find((item: any) => item.shift_source === "scheduled" && new Date(item.ends_at).getTime() >= now);
  const shift = liveShift || upcomingShift || null;
  const venue = Array.isArray(shift?.venues) ? shift.venues[0] : shift?.venues;
  const score = Array.isArray(row.trending_scores) ? row.trending_scores[0] : row.trending_scores;
  const approvedPhotos = approvedDancerPhotoSources(client, row);
  const primaryPhoto = approvedPhotos[0] || null;
  const dedicatedAvatar = responsivePublicImage(
    client,
    "dancer-photos",
    row.avatar_storage_path,
  );
  const avatarPhoto = dedicatedAvatar || primaryPhoto;

  return {
    shift,
    card: {
      id: row.id,
      slug: row.slug,
      stageName: row.stage_name,
      city: row.city,
      verified: true,
      primaryPhotoUrl: primaryPhoto?.imageUrl || null,
      primaryPhotoFocalX: primaryPhoto?.imageFocalX ?? 50,
      primaryPhotoFocalY: primaryPhoto?.imageFocalY ?? 50,
      primaryPhotoSrcSet: primaryPhoto?.imageSrcSet || null,
      primaryPhotoWidth: primaryPhoto?.imageWidth || null,
      primaryPhotoHeight: primaryPhoto?.imageHeight || null,
      avatarPhotoUrl: avatarPhoto?.imageUrl || null,
      avatarPhotoFocalX: avatarPhoto?.imageFocalX ?? 50,
      avatarPhotoFocalY: avatarPhoto?.imageFocalY ?? 50,
      avatarPhotoSrcSet: avatarPhoto?.imageSrcSet || null,
      avatarPhotoWidth: avatarPhoto?.imageWidth || null,
      avatarPhotoHeight: avatarPhoto?.imageHeight || null,
      galleryPhotoUrls: approvedPhotos.map((photo) => photo.imageUrl),
      galleryPhotoSrcSets: approvedPhotos.map(
        (photo) => photo.imageSrcSet || null,
      ),
      galleryPhotoIds: approvedPhotos.map((photo) => photo.id),
      galleryPhotoLikeCounts: approvedPhotos.map((photo) => photo.likeCount),
      socialLinks: approvedSocialLinks(row),
      currentRank: score?.rank || null,
      venueName: venue?.name || null,
      venueSlug: venue?.slug || null,
      venueId: shift?.venue_id || venue?.id || null,
      shiftId: shift?.id || null,
      shiftSource: shift?.shift_source || null,
      shiftLabel: shift ? formatShiftLabel(shift) : null,
      shiftStartsAt: shift?.starts_at || null,
      shiftEndsAt: shift?.ends_at || null,
      shiftTimeZone: shift?.timezone || venue?.timezone || null,
      locationStatus: publicLocationStatus(shift),
      checkedInAt: shift?.checked_in_at || null,
      checkedOutAt: shift?.checked_out_at || null,
      locationVerificationExpiresAt: shift?.location_verification_expires_at || null,
      followerCount: 0,
      notificationCount: 0,
      profileViewsToday: 0,
      goingCount: 0,
    },
  };
}

async function toDancerCards(
  client: DancrClient,
  rows: any[],
  options: DancerCardOptions = {},
): Promise<DancerCard[]> {
  return hydrateDancerCardMetrics(client, rows.map((row) => buildDancerCard(client, row, options).card));
}

async function hydrateDancerCardMetrics(client: DancrClient, cards: DancerCard[]): Promise<DancerCard[]> {
  if (!cards.length) return [];

  const dancerIds = [...new Set(cards.map((card) => card.id))];
  const shiftIds = [...new Set(cards.map((card) => card.shiftId).filter((shiftId): shiftId is string => Boolean(shiftId)))];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await (client as any).rpc("get_public_dancer_metric_counts", {
    p_dancer_ids: dancerIds,
    p_shift_ids: shiftIds,
    p_profile_views_since: today.toISOString(),
  });
  if (error) throw error;

  const followerCounts = new Map<string, number>();
  const notificationCounts = new Map<string, number>();
  const profileViewCounts = new Map<string, number>();
  const goingCounts = new Map<string, number>();

  for (const row of data || []) {
    const total = safeMetricCount(row.total);
    if (row.metric === "followers") followerCounts.set(row.entity_id, total);
    if (row.metric === "notifications") notificationCounts.set(row.entity_id, total);
    if (row.metric === "profile_views") profileViewCounts.set(row.entity_id, total);
    if (row.metric === "going") goingCounts.set(row.entity_id, total);
  }

  return cards.map((card) => ({
    ...card,
    followerCount: followerCounts.get(card.id) || 0,
    notificationCount: notificationCounts.get(card.id) || 0,
    profileViewsToday: profileViewCounts.get(card.id) || 0,
    goingCount: card.shiftId ? goingCounts.get(card.shiftId) || 0 : 0,
  }));
}

function safeMetricCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export type PublicVenuePopularity = {
  followerCount: number;
  directionRequests30d: number;
  profileViews30d: number;
};

export async function getPublicVenuePopularity(
  client: DancrClient,
  venueIds: string[],
): Promise<Map<string, PublicVenuePopularity>> {
  const uniqueVenueIds = [...new Set(venueIds.filter(Boolean))];
  const popularityByVenue = new Map(
    uniqueVenueIds.map((venueId) => [
      venueId,
      { followerCount: 0, directionRequests30d: 0, profileViews30d: 0 },
    ]),
  );
  if (!uniqueVenueIds.length) return popularityByVenue;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await (client as any).rpc("get_public_venue_metric_counts", {
    p_venue_ids: uniqueVenueIds,
    p_activity_since: since,
  });
  if (error) throw error;

  for (const row of data || []) {
    const popularity = popularityByVenue.get(row.entity_id);
    if (!popularity) continue;
    const total = safeMetricCount(row.total);
    if (row.metric === "followers") popularity.followerCount = total;
    if (row.metric === "directions") popularity.directionRequests30d = total;
    if (row.metric === "profile_views") popularity.profileViews30d = total;
  }

  return popularityByVenue;
}

function approvedDancerPhotoSources(client: DancrClient, row: any) {
  const photos = (row.dancer_photos || []).filter((photo: any) => photo.review_status === "approved");
  const ordered = [...photos].sort((left: any, right: any) => {
    if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
    return Number(left.sort_order || 0) - Number(right.sort_order || 0);
  });
  return ordered.flatMap((photo: any) => {
    const image = responsivePublicImage(client, "dancer-photos", photo.storage_path);
    return image ? [{
      ...image,
      id: String(photo.id || ""),
      likeCount: safeMetricCount(photo.like_count),
    }] : [];
  });
}

function approvedSocialLinks(row: any) {
  return (row.social_links || [])
    .filter((link: any) => link.is_active !== false && link.url)
    .flatMap(safePublicSocialLink);
}

function safePublicSocialLink(link: any) {
  const platform = link.platform as SocialPlatform;
  const url = safeSocialProfileUrl(platform, link.url);
  if (!url) return [];
  return [{
    id: String(link.id || ""),
    platform,
    handle: socialProfileHandle(platform, url),
    url,
  }];
}

function toDancerPhotoUrl(client: DancrClient, storagePath: string) {
  return (
    responsivePublicImage(client, "dancer-photos", storagePath)?.imageUrl || ""
  );
}

function toShiftSummary(row: any): ShiftSummary {
  const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;

  return {
    id: row.id,
    venueId: row.venue_id || venue?.id,
    venueName: venue?.name,
    venueSlug: venue?.slug,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    shiftDate: row.shift_date || null,
    shiftSource: row.shift_source || "scheduled",
    timezone: row.timezone || venue?.timezone || null,
    status: row.status,
    locationStatus: publicLocationStatus(row),
    checkedInAt: row.checked_in_at || null,
    checkedOutAt: row.checked_out_at || null,
    locationVerificationExpiresAt: row.location_verification_expires_at || null,
  };
}

function venueCoverImageFields(
  client: DancrClient,
  storagePath?: string | null,
) {
  const image = responsivePublicImage(
    client,
    "venue-cover-images",
    storagePath,
  );
  return {
    coverImageHeight: image?.imageHeight || null,
    coverImageSrcSet: image?.imageSrcSet || null,
    coverImageUrl: image?.imageUrl || null,
    coverImageWidth: image?.imageWidth || null,
  };
}

function isShiftPubliclyVisible(shift: any, now = Date.now()) {
  if (shift.checked_out_at) return false;
  if (isActiveNfcPresence(shift, now)) return true;
  return shift.shift_source === "scheduled" && new Date(shift.ends_at).getTime() >= now;
}

function publicLocationStatus(shift: any): "self_reported" | "location_confirmed" | "club_confirmed" {
  if (!shift) return "self_reported";
  if (isActiveNfcPresence(shift)) return "club_confirmed";
  return "self_reported";
}

async function getCityTimeZone(client: DancrClient, city: string) {
  const { data, error } = await client
    .from("venues")
    .select("timezone")
    .ilike("city", city.trim())
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.timezone || "America/Los_Angeles";
}

function formatShiftLabel(shift: any): string {
  if (isActiveNfcPresence(shift)) return "Working Now";
  return `Upcoming · ${formatPublicShiftStartDate(shift.shift_date || shift.starts_at)}`;
}

function formatPublicShiftStartDate(startsAt: string): string {
  const start = new Date(startsAt);
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
  });

  return dateFormatter.format(start);
}

export function formatVenueHours(opensAt: string | null, closesAt: string | null): string | null {
  if (!opensAt || !closesAt) return null;

  return `${formatTimeOnly(opensAt)} - ${formatTimeOnly(closesAt)}`;
}

function formatTimeOnly(value: string): string {
  const [hourRaw, minuteRaw = "0"] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const suffix = hour >= 12 ? "p" : "a";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}
