import type { SupabaseClient } from "@supabase/supabase-js";
import { isApprovedPublicDancerRow } from "./public";
import { responsivePublicImage } from "./responsive-image";
import { isCurrentLocationVerification } from "./geofence";

type DancrClient = SupabaseClient;

function isMissingIsPublicColumnError(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && message.includes("is_public");
}

export async function getCustomerSavedItems(client: DancrClient, customerId: string) {
  const [follows, favorites, venueFollows, goingSignals] = await Promise.all([
    getFollowedDancers(client, customerId),
    getFavoriteDancers(client, customerId),
    getFollowedVenues(client, customerId),
    getGoingShifts(client, customerId),
  ]);

  const dancerIds = Array.from(new Set([
    ...follows.map((item: any) => item.dancer?.id),
    ...favorites.map((item: any) => item.dancer?.id),
  ].filter(Boolean)));
  const schedules = await getSavedDancerSchedules(client, dancerIds);
  const attachSchedule = (item: any) => ({
    ...item,
    dancer: item.dancer
      ? { ...item.dancer, nextShift: schedules.get(item.dancer.id) || null }
      : null,
  });

  return {
    follows: follows.map(attachSchedule),
    favorites: favorites.map(attachSchedule),
    venueFollows,
    goingSignals,
  };
}

export async function followDancer(client: DancrClient, customerId: string, dancerId: string) {
  const { error } = await client.from("follows").upsert({
    customer_id: customerId,
    dancer_id: dancerId,
    notifications_enabled: true,
  });

  if (error) throw error;
}

export async function unfollowDancer(client: DancrClient, customerId: string, dancerId: string) {
  const { error } = await client.from("follows").delete().match({
    customer_id: customerId,
    dancer_id: dancerId,
  });

  if (error) throw error;
}

export async function setDancerNotifications(
  client: DancrClient,
  customerId: string,
  dancerId: string,
  enabled: boolean,
) {
  const { error } = await client.from("follows").upsert({
    customer_id: customerId,
    dancer_id: dancerId,
    notifications_enabled: enabled,
  });

  if (error) throw error;
}

export async function followVenue(client: DancrClient, customerId: string, venueId: string) {
  const { error } = await client.from("venue_follows").upsert({
    customer_id: customerId,
    venue_id: venueId,
    notifications_enabled: true,
  });

  if (error) throw error;
}

export async function unfollowVenue(client: DancrClient, customerId: string, venueId: string) {
  const { error } = await client.from("venue_follows").delete().match({
    customer_id: customerId,
    venue_id: venueId,
  });

  if (error) throw error;
}

export async function markGoing(client: DancrClient, customerId: string, shiftId: string) {
  const { error } = await client.from("going_signals").insert({
    customer_id: customerId,
    shift_id: shiftId,
  });

  if (error && error.code !== "23505") throw error;
}

export async function cancelGoing(client: DancrClient, customerId: string, shiftId: string) {
  const { error } = await client.from("going_signals").delete().match({
    customer_id: customerId,
    shift_id: shiftId,
  });

  if (error) throw error;
}

export async function markAnonymousGoing(client: DancrClient, visitorTokenHash: string, shiftId: string) {
  const { error } = await client.from("going_signals").insert({
    visitor_token_hash: visitorTokenHash,
    shift_id: shiftId,
  });

  if (error && error.code !== "23505") throw error;
}

export async function cancelAnonymousGoing(client: DancrClient, visitorTokenHash: string, shiftId: string) {
  const { error } = await client.from("going_signals").delete().match({
    visitor_token_hash: visitorTokenHash,
    shift_id: shiftId,
  });

  if (error) throw error;
}

export async function favoriteDancer(client: DancrClient, customerId: string, dancerId: string) {
  const { error } = await client.from("favorites").upsert({
    customer_id: customerId,
    dancer_id: dancerId,
  });

  if (error) throw error;
}

export async function unfavoriteDancer(client: DancrClient, customerId: string, dancerId: string) {
  const { error } = await client.from("favorites").delete().match({
    customer_id: customerId,
    dancer_id: dancerId,
  });

  if (error) throw error;
}

export async function recordDirectionRequest(
  client: DancrClient,
  customerId: string,
  input: { venueId: string; dancerIds?: string[]; sessionId?: string | null },
) {
  const dancerIds = Array.from(new Set((input.dancerIds || []).filter(Boolean)));
  const rows = dancerIds.length
    ? dancerIds.map((dancerId) => ({
        dancer_id: dancerId,
        venue_id: input.venueId,
        requester_id: customerId,
        session_id: input.sessionId || null,
      }))
    : [{
        venue_id: input.venueId,
        requester_id: customerId,
        session_id: input.sessionId || null,
      }];

  const { error } = await client.from("direction_requests").insert(rows);

  if (error) throw error;

  return rows.length;
}

async function getFollowedDancers(client: DancrClient, customerId: string) {
  const current = await client
    .from("follows")
    .select("dancer_id, notifications_enabled, created_at, dancer_profiles(id, slug, stage_name, city, status, verification_status, venue_approved_at, is_public, dancer_photos(storage_path, is_primary, review_status, sort_order))")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  let data: any[] | null = current.data as any[] | null;
  let error: any = current.error;
  if (isMissingIsPublicColumnError(error)) {
    console.warn("CUSTOMER_SAVED_VISIBILITY_COLUMN_MISSING", { relation: "follows", code: error.code });
    const legacy = await client
      .from("follows")
      .select("dancer_id, notifications_enabled, created_at, dancer_profiles(id, slug, stage_name, city, status, dancer_photos(storage_path, is_primary, review_status, sort_order))")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    data = legacy.data as any[] | null;
    error = legacy.error;
  }

  if (error) throw error;

  return (data || []).map((row: any) => ({
    dancerId: row.dancer_id,
    notificationsEnabled: row.notifications_enabled,
    createdAt: row.created_at,
    dancer: toDancerSummary(client, row.dancer_profiles),
  })).filter((item: any) => item.dancer);
}

async function getFavoriteDancers(client: DancrClient, customerId: string) {
  const current = await client
    .from("favorites")
    .select("dancer_id, created_at, dancer_profiles(id, slug, stage_name, city, status, verification_status, venue_approved_at, is_public, dancer_photos(storage_path, is_primary, review_status, sort_order))")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  let data: any[] | null = current.data as any[] | null;
  let error: any = current.error;
  if (isMissingIsPublicColumnError(error)) {
    console.warn("CUSTOMER_SAVED_VISIBILITY_COLUMN_MISSING", { relation: "favorites", code: error.code });
    const legacy = await client
      .from("favorites")
      .select("dancer_id, created_at, dancer_profiles(id, slug, stage_name, city, status, dancer_photos(storage_path, is_primary, review_status, sort_order))")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    data = legacy.data as any[] | null;
    error = legacy.error;
  }

  if (error) throw error;

  return (data || []).map((row: any) => ({
    dancerId: row.dancer_id,
    createdAt: row.created_at,
    dancer: toDancerSummary(client, row.dancer_profiles),
  })).filter((item: any) => item.dancer);
}

async function getFollowedVenues(client: DancrClient, customerId: string) {
  const { data, error } = await client
    .from("venue_follows")
    .select("venue_id, notifications_enabled, created_at, venues(id, slug, name, city, state, address, latitude, longitude, is_active, cover_image_storage_path)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    venueId: row.venue_id,
    notificationsEnabled: row.notifications_enabled,
    createdAt: row.created_at,
    venue: toVenueSummary(client, row.venues),
  })).filter((item: any) => item.venue);
}

async function getGoingShifts(client: DancrClient, customerId: string) {
  const current = await client
    .from("going_signals")
    .select(
      "shift_id, created_at, shifts(id, starts_at, ends_at, timezone, status, dancer_profiles(id, slug, stage_name, city, status, verification_status, venue_approved_at, is_public, dancer_photos(storage_path, is_primary, review_status, sort_order)), venues(id, slug, name, city, state, address, latitude, longitude, is_active, cover_image_storage_path))",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  let data: any[] | null = current.data as any[] | null;
  let error: any = current.error;
  if (isMissingIsPublicColumnError(error)) {
    console.warn("CUSTOMER_SAVED_VISIBILITY_COLUMN_MISSING", { relation: "going_signals", code: error.code });
    const legacy = await client
      .from("going_signals")
      .select(
        "shift_id, created_at, shifts(id, starts_at, ends_at, timezone, status, dancer_profiles(id, slug, stage_name, city, status, dancer_photos(storage_path, is_primary, review_status, sort_order)), venues(id, slug, name, city, state, address, latitude, longitude, is_active, cover_image_storage_path))",
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    data = legacy.data as any[] | null;
    error = legacy.error;
  }

  if (error) throw error;

  return (data || []).map((row: any) => {
    const shift = single(row.shifts);

    return {
      shiftId: row.shift_id,
      createdAt: row.created_at,
      shift: shift
        ? {
            id: shift.id,
            startsAt: shift.starts_at,
            endsAt: shift.ends_at,
            timezone: shift.timezone,
            status: shift.status,
            dancer: toDancerSummary(client, shift.dancer_profiles),
            venue: toVenueSummary(client, shift.venues),
          }
        : null,
    };
  }).filter((item: any) => item.shift?.dancer && item.shift?.venue);
}

async function getSavedDancerSchedules(client: DancrClient, dancerIds: string[]) {
  const schedules = new Map<string, any>();
  if (!dancerIds.length) return schedules;

  const { data, error } = await client
    .from("shifts")
    .select("id, dancer_id, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venues(id, slug, name, city, state, address, latitude, longitude, is_active, cover_image_storage_path)")
    .in("dancer_id", dancerIds)
    .eq("status", "posted")
    .gt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  if (error) throw error;

  for (const shift of data || []) {
    if (schedules.has(shift.dancer_id)) continue;
    const venue = toVenueSummary(client, shift.venues);
    if (!venue) continue;
    schedules.set(shift.dancer_id, {
      id: shift.id,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      timezone: shift.timezone,
      status: shift.status,
      locationStatus: isCurrentLocationVerification(shift) ? shift.location_status : "self_reported",
      checkedInAt: shift.checked_in_at,
      checkedOutAt: shift.checked_out_at,
      venue,
    });
  }

  return schedules;
}

function toDancerSummary(client: DancrClient, value: any) {
  const dancer = single(value);
  if (!isApprovedPublicDancerRow(dancer)) return null;
  const primaryPhoto = (dancer.dancer_photos || [])
    .filter((photo: any) => photo.review_status === "approved")
    .sort((left: any, right: any) => {
      if (Boolean(left.is_primary) !== Boolean(right.is_primary)) return left.is_primary ? -1 : 1;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    })[0];
  const image = responsivePublicImage(client, "dancer-photos", primaryPhoto?.storage_path);

  return {
    id: dancer.id,
    slug: dancer.slug,
    stageName: dancer.stage_name,
    city: dancer.city,
    status: dancer.status,
    imageFocalX: image?.imageFocalX ?? 50,
    imageFocalY: image?.imageFocalY ?? 50,
    imageUrl: image?.imageUrl || null,
    imageSrcSet: image?.imageSrcSet || null,
    imageWidth: image?.imageWidth || null,
    imageHeight: image?.imageHeight || null,
  };
}

function toVenueSummary(client: DancrClient, value: any) {
  const venue = single(value);
  if (!venue || venue.is_active === false) return null;
  const image = responsivePublicImage(client, "venue-cover-images", venue.cover_image_storage_path);

  return {
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    city: venue.city,
    state: venue.state,
    address: venue.address || null,
    latitude: Number.isFinite(Number(venue.latitude)) ? Number(venue.latitude) : null,
    longitude: Number.isFinite(Number(venue.longitude)) ? Number(venue.longitude) : null,
    imageUrl: image?.imageUrl || null,
    imageSrcSet: image?.imageSrcSet || null,
    imageWidth: image?.imageWidth || null,
    imageHeight: image?.imageHeight || null,
  };
}

function single(value: any) {
  return Array.isArray(value) ? value[0] : value;
}
