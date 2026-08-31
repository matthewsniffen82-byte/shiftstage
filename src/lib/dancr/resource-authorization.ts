import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy.ts";

type DancrClient = SupabaseClient;

export async function requirePublicDancer(client: DancrClient, dancerId: string) {
  const { data, error } = await (client as any)
    .from("dancer_profiles")
    .select("id")
    .eq("id", dancerId)
    .eq("status", "approved")
    .eq("verification_status", "approved")
    .eq("is_public", true)
    .is("disabled_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw unavailable("Dancer is unavailable.");
  return String(data.id);
}

export async function requirePublicVenue(client: DancrClient, venueId: string) {
  const { data, error } = await (client as any)
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw unavailable("Venue is unavailable.");
  return String(data.id);
}

export async function requirePublicClubDeal(client: DancrClient, dealId: string) {
  const { data, error } = await (client as any)
    .from("club_deals")
    .select("id, venue_id")
    .eq("id", dealId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw unavailable("Club Deal is unavailable.");

  await requirePublicVenue(client, String(data.venue_id));
  return { dealId: String(data.id), venueId: String(data.venue_id) };
}

export async function requirePublicShiftForDancer(
  client: DancrClient,
  dancerId: string,
  shiftId: string,
  now = new Date(),
) {
  const { data, error } = await (client as any)
    .from("shifts")
    .select("id")
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .eq("status", "posted")
    .gt("ends_at", now.toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) throw unavailable("Schedule is unavailable.");
  return String(data.id);
}

export async function requirePublicDancersAtVenue(
  client: DancrClient,
  venueId: string,
  dancerIds: string[],
  now = new Date(),
) {
  await requirePublicVenue(client, venueId);
  const uniqueDancerIds = [...new Set(dancerIds)];
  if (!uniqueDancerIds.length) return [];

  const { data: dancers, error: dancerError } = await (client as any)
    .from("dancer_profiles")
    .select("id")
    .in("id", uniqueDancerIds)
    .eq("status", "approved")
    .eq("verification_status", "approved")
    .eq("is_public", true)
    .is("disabled_at", null);
  if (dancerError) throw dancerError;
  const publicDancerIds = new Set((dancers || []).map((row: any) => String(row.id)));
  if (uniqueDancerIds.some((dancerId) => !publicDancerIds.has(dancerId))) {
    throw unavailable("Dancer is unavailable.");
  }

  const { data: shifts, error: shiftError } = await (client as any)
    .from("shifts")
    .select("dancer_id")
    .eq("venue_id", venueId)
    .in("dancer_id", uniqueDancerIds)
    .eq("status", "posted")
    .gt("ends_at", now.toISOString());
  if (shiftError) throw shiftError;
  const scheduledDancerIds = new Set((shifts || []).map((row: any) => String(row.dancer_id)));
  if (uniqueDancerIds.some((dancerId) => !scheduledDancerIds.has(dancerId))) {
    throw unavailable("Dancer is not scheduled at this venue.");
  }

  return uniqueDancerIds;
}

function unavailable(message: string) {
  return new PublicApiError("NOT_FOUND", message, 404);
}
