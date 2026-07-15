import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerCard, DancerProfile, ShiftSummary, VenueSummary } from "./types";
import { getTonightWindow } from "./schedule";

type DancrClient = SupabaseClient;

export function isApprovedPublicDancerRow(dancer: any) {
  const status = String(dancer?.status || "").toLowerCase();
  const verificationStatus = String(dancer?.verification_status || dancer?.verificationStatus || "").toLowerCase();
  const photoReviewStatus = String(dancer?.photo_review_status || dancer?.photoReviewStatus || "").toLowerCase();
  const explicitlyBlocked = status === "rejected" || status === "disabled";
  const fullyReviewed = verificationStatus === "approved" && photoReviewStatus === "approved";

  return Boolean(
    dancer &&
    !explicitlyBlocked &&
    dancer.is_public !== false &&
    (status === "approved" || fullyReviewed),
  );
}

export async function getApprovedDancersByCity(client: DancrClient, city: string): Promise<DancerCard[]> {
  const cityName = city.trim();
  const { data, error } = await client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        status,
        verification_status,
        photo_review_status,
        is_public,
        trending_scores(rank),
        dancer_photos(storage_path, is_primary, review_status, sort_order),
        social_links(id, platform, handle, url, is_active),
        shifts(id, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, checkin_distance_feet, venue_id, venues(id, name, slug, timezone))
      `,
    )
    .ilike("city", cityName)
    .or("is_public.is.true,is_public.is.null")
    .order("stage_name", { ascending: true })
    .order("starts_at", { referencedTable: "shifts", ascending: true });

  if (error) throw error;

  const rows = (data || []).filter(isApprovedPublicDancerRow);
  console.log("PUBLIC_DANCERS_QUERY_RESULT", {
    city: cityName,
    rawCount: data?.length || 0,
    publicApprovedCount: rows.length,
  });

  return Promise.all(rows.map((row: any) => toDancerCard(client, row)));
}

export async function getTonightShifts(client: DancrClient, city: string, now = new Date()): Promise<DancerCard[]> {
  const cityName = city.trim();
  const timeZone = await getCityTimeZone(client, cityName);
  const window = getTonightWindow(timeZone, now);

  const { data, error } = await client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        status,
        verification_status,
        photo_review_status,
        is_public,
        trending_scores(rank),
        dancer_photos(storage_path, is_primary, review_status, sort_order),
        social_links(id, platform, handle, url, is_active),
        shifts!inner(id, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, checkin_distance_feet, venue_id, venues(id, name, slug, timezone))
      `,
    )
    .ilike("city", cityName)
    .or("is_public.is.true,is_public.is.null")
    .eq("shifts.status", "posted")
    .not("shifts.checked_in_at", "is", null)
    .is("shifts.checked_out_at", null)
    .lt("shifts.starts_at", window.endsAt)
    .gt("shifts.ends_at", window.activeAfter)
    .order("starts_at", { referencedTable: "shifts", ascending: true });

  if (error) throw error;

  const rows = (data || []).filter(isApprovedPublicDancerRow);
  const cards = await Promise.all(rows.map((row: any) => toDancerCard(client, row, { checkedInOnly: true })));
  return cards.filter((card) => card.shiftId && card.locationStatus !== "self_reported");
}

export async function getDancerProfile(client: DancrClient, slug: string): Promise<DancerProfile | null> {
  const { data, error } = await client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        bio,
        status,
        verification_status,
        photo_review_status,
        is_public,
        trending_scores(rank),
        dancer_photos(id, storage_path, is_primary, sort_order, review_status),
        social_links(id, platform, handle, url, is_active),
        shifts(id, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, checkin_distance_feet, venues(id, name, slug, timezone))
      `,
    )
    .eq("slug", slug)
    .or("is_public.is.true,is_public.is.null")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row: any = data;
  if (!isApprovedPublicDancerRow(row)) return null;
  const approvedPhotos = await getApprovedDancerPhotos(client, row.id);
  const card = await toDancerCard(client, { ...row, dancer_photos: approvedPhotos });
  const goingCount = await countDancerGoingSignals(client, row.id);

  return {
    ...card,
    bio: row.bio || null,
    followerCount: card.followerCount || 0,
    goingCount,
    photos: approvedPhotos.map((photo: any) => ({
      id: photo.id,
      imageUrl: toDancerPhotoUrl(client, photo.storage_path),
      isPrimary: photo.is_primary,
      sortOrder: photo.sort_order,
    })),
    socialLinks: (row.social_links || [])
      .filter((link: any) => link.is_active !== false)
      .map((link: any) => ({
        id: link.id,
        platform: link.platform,
        handle: link.handle,
        url: link.url,
      })),
    upcomingShifts: (row.shifts || [])
      .filter((shift: any) => shift.status === "posted" && isShiftPubliclyVisible(shift))
      .map(toShiftSummary),
  };
}

async function getApprovedDancerPhotos(client: DancrClient, dancerId: string) {
  const { data, error } = await client
    .from("dancer_photos")
    .select("id, storage_path, is_primary, sort_order, review_status, created_at")
    .eq("dancer_id", dancerId)
    .eq("review_status", "approved")
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getVenueProfile(client: DancrClient, slug: string): Promise<VenueSummary | null> {
  const { data, error } = await client
    .from("venues")
    .select("id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

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
  };
}

export async function getUpcomingShiftsForDancer(client: DancrClient, dancerId: string): Promise<ShiftSummary[]> {
  const { data, error } = await client
    .from("shifts")
    .select("id, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, venue_id, venues(id, name, slug, timezone)")
    .eq("dancer_id", dancerId)
    .eq("status", "posted")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

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

async function toDancerCard(client: DancrClient, row: any, options: { checkedInOnly?: boolean } = {}): Promise<DancerCard> {
  const shifts = Array.isArray(row.shifts) ? row.shifts : row.shifts ? [row.shifts] : [];
  const now = Date.now();
  const postedShifts = shifts.filter((item: any) => item.status === "posted");
  const visibleShifts = postedShifts
    .filter((item: any) => isShiftPubliclyVisible(item, now))
    .filter((item: any) => !options.checkedInOnly || publicLocationStatus(item) !== "self_reported")
    .sort((left: any, right: any) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const liveShift = visibleShifts.find((item: any) => {
    const startsAt = new Date(item.starts_at).getTime();
    const endsAt = new Date(item.ends_at).getTime();
    return startsAt <= now && endsAt >= now && publicLocationStatus(item) !== "self_reported";
  });
  const upcomingShift = visibleShifts.find((item: any) => new Date(item.ends_at).getTime() >= now);
  const shift = liveShift || upcomingShift || null;
  const venue = Array.isArray(shift?.venues) ? shift.venues[0] : shift?.venues;
  const score = Array.isArray(row.trending_scores) ? row.trending_scores[0] : row.trending_scores;
  const approvedPhotoUrls = approvedDancerPhotoUrls(client, row);
  const [followerCount, notificationCount, profileViewsToday] = await Promise.all([
    countDancerFollowers(client, row.id),
    countDancerNotificationSubscribers(client, row.id),
    countDancerProfileViewsToday(client, row.id),
  ]);

  return {
    id: row.id,
    slug: row.slug,
    stageName: row.stage_name,
    city: row.city,
    verified: true,
    primaryPhotoUrl: approvedPhotoUrls[0] || null,
    galleryPhotoUrls: approvedPhotoUrls,
    socialLinks: approvedSocialLinks(row),
    currentRank: score?.rank || null,
    venueName: venue?.name || null,
    venueSlug: venue?.slug || null,
    venueId: shift?.venue_id || venue?.id || null,
    shiftId: shift?.id || null,
    shiftLabel: shift ? formatShiftLabel(shift) : null,
    shiftStartsAt: shift?.starts_at || null,
    shiftEndsAt: shift?.ends_at || null,
    shiftTimeZone: shift?.timezone || venue?.timezone || null,
    locationStatus: publicLocationStatus(shift),
    checkedInAt: shift?.checked_in_at || null,
    checkedOutAt: shift?.checked_out_at || null,
    checkinDistanceFeet: shift?.checkin_distance_feet ?? null,
    followerCount,
    notificationCount,
    profileViewsToday,
  };
}

function approvedDancerPhotoUrls(client: DancrClient, row: any): string[] {
  const photos = (row.dancer_photos || []).filter((photo: any) => photo.review_status === "approved");
  const ordered = [...photos].sort((left: any, right: any) => {
    if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
    return Number(left.sort_order || 0) - Number(right.sort_order || 0);
  });
  return ordered.map((photo: any) => photo.storage_path ? toDancerPhotoUrl(client, photo.storage_path) : "").filter(Boolean);
}

function approvedSocialLinks(row: any) {
  return (row.social_links || [])
    .filter((link: any) => link.is_active !== false && link.url)
    .map((link: any) => ({
      id: link.id,
      platform: link.platform,
      handle: link.handle,
      url: link.url,
    }));
}

function toDancerPhotoUrl(client: DancrClient, storagePath: string) {
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  return client.storage.from("dancer-photos").getPublicUrl(storagePath).data.publicUrl;
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
    timezone: row.timezone || venue?.timezone || null,
    status: row.status,
    locationStatus: publicLocationStatus(row),
    checkedInAt: row.checked_in_at || null,
    checkedOutAt: row.checked_out_at || null,
  };
}

function isShiftPubliclyVisible(shift: any, now = Date.now()) {
  if (shift.checked_out_at) return false;
  return new Date(shift.ends_at).getTime() >= now;
}

function publicLocationStatus(shift: any): "self_reported" | "location_confirmed" | "club_confirmed" {
  if (!shift) return "self_reported";
  if (shift.location_status === "club_confirmed") return "club_confirmed";
  if (
    shift.location_status === "location_confirmed" &&
    shift.checked_in_at &&
    !shift.checked_out_at &&
    new Date(shift.ends_at).getTime() >= Date.now()
  ) {
    return "location_confirmed";
  }
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
  const startMs = new Date(shift.starts_at).getTime();
  const isCheckedIn = publicLocationStatus(shift) !== "self_reported";

  if (isCheckedIn) return "Working Now";
  if (startMs > Date.now()) return `Starts ${formatPublicShiftStartDate(shift.starts_at)}`;
  return "Scheduled";
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
