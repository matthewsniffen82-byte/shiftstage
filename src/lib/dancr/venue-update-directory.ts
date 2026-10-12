import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VenueCustomer } from "./venue-customers";

export async function listVenueUpdateSubscribers(admin: SupabaseClient, venueId: string, channel: "email" | "text", offset: number): Promise<VenueCustomer[]> {
  const { data, error } = await admin.from("venue_update_subscriptions").select("id,name,channel,destination,consented_at")
    .eq("venue_id", venueId).eq("channel", channel).is("withdrawn_at", null)
    .order("consented_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 50);
  if (error) throw error;
  return (data || []).map(row => ({ id: `updates:${row.id}`, name: row.name, email: channel === "email" ? row.destination : null,
    phone: channel === "text" ? row.destination : null, city: "", joined_at: row.consented_at, is_follower: false, is_guest: false,
    is_updates: true, email_updates_at: channel === "email" ? row.consented_at : null, text_updates_at: channel === "text" ? row.consented_at : null }));
}

export async function attachVenueUpdateStatuses(admin: SupabaseClient, venueId: string, rows: VenueCustomer[]): Promise<VenueCustomer[]> {
  const destinations = [...new Set(rows.flatMap(row => [row.email?.trim().toLowerCase(), row.phone]).filter((value): value is string => Boolean(value)))];
  if (!destinations.length) return rows;
  const { data, error } = await admin.from("venue_update_subscriptions").select("channel,destination,consented_at")
    .eq("venue_id", venueId).is("withdrawn_at", null).in("destination", destinations);
  if (error) throw error;
  const dates = new Map((data || []).map(row => [`${row.channel}:${row.destination}`, row.consented_at]));
  return rows.map(row => ({ ...row, email_updates_at: dates.get(`email:${row.email?.trim().toLowerCase()}`) || null,
    text_updates_at: dates.get(`text:${row.phone}`) || null }));
}
