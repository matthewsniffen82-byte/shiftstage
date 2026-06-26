import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function getCustomerSavedItems(client: DancrClient, customerId: string) {
  const [follows, favorites, venueFollows, goingSignals] = await Promise.all([
    getFollowedDancers(client, customerId),
    getFavoriteDancers(client, customerId),
    getFollowedVenues(client, customerId),
    getGoingShifts(client, customerId),
  ]);

  return {
    follows,
    favorites,
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
  const { error } = await client.from("going_signals").upsert({
    customer_id: customerId,
    shift_id: shiftId,
  });

  if (error) throw error;
}

export async function cancelGoing(client: DancrClient, customerId: string, shiftId: string) {
  const { error } = await client.from("going_signals").delete().match({
    customer_id: customerId,
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
  const { data, error } = await client
    .from("follows")
    .select("dancer_id, notifications_enabled, created_at, dancer_profiles(id, slug, stage_name, city, status)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    dancerId: row.dancer_id,
    notificationsEnabled: row.notifications_enabled,
    createdAt: row.created_at,
    dancer: toDancerSummary(row.dancer_profiles),
  }));
}

async function getFavoriteDancers(client: DancrClient, customerId: string) {
  const { data, error } = await client
    .from("favorites")
    .select("dancer_id, created_at, dancer_profiles(id, slug, stage_name, city, status)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    dancerId: row.dancer_id,
    createdAt: row.created_at,
    dancer: toDancerSummary(row.dancer_profiles),
  }));
}

async function getFollowedVenues(client: DancrClient, customerId: string) {
  const { data, error } = await client
    .from("venue_follows")
    .select("venue_id, notifications_enabled, created_at, venues(id, slug, name, city, state)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    venueId: row.venue_id,
    notificationsEnabled: row.notifications_enabled,
    createdAt: row.created_at,
    venue: toVenueSummary(row.venues),
  }));
}

async function getGoingShifts(client: DancrClient, customerId: string) {
  const { data, error } = await client
    .from("going_signals")
    .select(
      "shift_id, created_at, shifts(id, starts_at, ends_at, timezone, status, dancer_profiles(id, slug, stage_name, city, status), venues(id, slug, name, city, state))",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

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
            dancer: toDancerSummary(shift.dancer_profiles),
            venue: toVenueSummary(shift.venues),
          }
        : null,
    };
  });
}

function toDancerSummary(value: any) {
  const dancer = single(value);
  if (!dancer) return null;

  return {
    id: dancer.id,
    slug: dancer.slug,
    stageName: dancer.stage_name,
    city: dancer.city,
    status: dancer.status,
  };
}

function toVenueSummary(value: any) {
  const venue = single(value);
  if (!venue) return null;

  return {
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    city: venue.city,
    state: venue.state,
  };
}

function single(value: any) {
  return Array.isArray(value) ? value[0] : value;
}
