import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerCard, DancerProfile, Database, ShiftSummary, VenueSummary } from "./types";

type DancrClient = SupabaseClient<Database>;

export async function getApprovedDancersByCity(client: DancrClient, city: string): Promise<DancerCard[]> {
  const { data, error } = await client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        primary_photo_url,
        trending_scores(rank),
        shifts!inner(starts_at, ends_at, venues(name, slug))
      `,
    )
    .eq("status", "approved")
    .eq("city", city)
    .order("stage_name", { ascending: true });

  if (error) throw error;

  return (data || []).map((row: any) => toDancerCard(row));
}

export async function getTonightShifts(client: DancrClient, city: string, now = new Date()): Promise<DancerCard[]> {
  const dayStart = new Date(now);
  dayStart.setHours(0, 1, 0, 0);

  const dayEnd = new Date(now);
  dayEnd.setDate(dayEnd.getDate() + 1);
  dayEnd.setHours(3, 1, 0, 0);

  const { data, error } = await client
    .from("dancer_profiles")
    .select(
      `
        id,
        slug,
        stage_name,
        city,
        primary_photo_url,
        trending_scores(rank),
        shifts!inner(starts_at, ends_at, venues(name, slug))
      `,
    )
    .eq("status", "approved")
    .eq("city", city)
    .eq("shifts.status", "posted")
    .gte("shifts.starts_at", dayStart.toISOString())
    .lte("shifts.ends_at", dayEnd.toISOString())
    .order("starts_at", { referencedTable: "shifts", ascending: true });

  if (error) throw error;

  return (data || []).map((row: any) => toDancerCard(row));
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
        primary_photo_url,
        follower_count,
        going_count,
        trending_scores(rank),
        dancer_photos(id, image_url, is_primary, sort_order),
        social_links(id, platform, handle, url),
        shifts(id, starts_at, ends_at, status, venues(id, name, slug))
      `,
    )
    .eq("status", "approved")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row: any = data;
  const card = toDancerCard(row);

  return {
    ...card,
    bio: row.bio || null,
    followerCount: row.follower_count || 0,
    goingCount: row.going_count || 0,
    photos: (row.dancer_photos || [])
      .map((photo: any) => ({
        id: photo.id,
        imageUrl: photo.image_url,
        isPrimary: photo.is_primary,
        sortOrder: photo.sort_order,
      }))
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder),
    socialLinks: (row.social_links || []).map((link: any) => ({
      id: link.id,
      platform: link.platform,
      handle: link.handle,
      url: link.url,
    })),
    upcomingShifts: (row.shifts || []).filter((shift: any) => shift.status === "posted").map(toShiftSummary),
  };
}

export async function getVenueProfile(client: DancrClient, slug: string): Promise<VenueSummary | null> {
  const { data, error } = await client
    .from("venues")
    .select("id, slug, name, city, state, hours_label")
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
    hoursLabel: data.hours_label,
  };
}

export async function getUpcomingShiftsForDancer(client: DancrClient, dancerId: string): Promise<ShiftSummary[]> {
  const { data, error } = await client
    .from("shifts")
    .select("id, starts_at, ends_at, status, venue_id, venues(id, name, slug)")
    .eq("dancer_id", dancerId)
    .eq("status", "posted")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  if (error) throw error;

  return (data || []).map(toShiftSummary);
}

function toDancerCard(row: any): DancerCard {
  const shift = Array.isArray(row.shifts) ? row.shifts[0] : row.shifts;
  const venue = Array.isArray(shift?.venues) ? shift.venues[0] : shift?.venues;
  const score = Array.isArray(row.trending_scores) ? row.trending_scores[0] : row.trending_scores;

  return {
    id: row.id,
    slug: row.slug,
    stageName: row.stage_name,
    city: row.city,
    verified: true,
    primaryPhotoUrl: row.primary_photo_url || null,
    currentRank: score?.rank || null,
    venueName: venue?.name || null,
    venueSlug: venue?.slug || null,
    shiftLabel: shift ? formatShiftLabel(shift.starts_at, shift.ends_at) : null,
    shiftStartsAt: shift?.starts_at || null,
    shiftEndsAt: shift?.ends_at || null,
  };
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
    status: row.status,
  };
}

function formatShiftLabel(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `${formatter.format(start)} - ${formatter.format(end)}`.replaceAll(" AM", "a").replaceAll(" PM", "p");
}
