import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { normalizeGuestAccent, type VenueGuestColors } from "./venue-guest-theme";

export async function getVenueGuestColors(client: SupabaseClient, venueId: string): Promise<VenueGuestColors & { configured: boolean }> {
  const { data, error } = await client.from("venue_guest_colors").select("internal_accent,embed_accent").eq("venue_id", venueId).maybeSingle();
  if (error) throw error;
  return { internalAccent: normalizeGuestAccent(data?.internal_accent), embedAccent: normalizeGuestAccent(data?.embed_accent), configured: Boolean(data) };
}

export function parseVenueGuestColors(value: unknown): VenueGuestColors {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicApiError("INVALID_REQUEST", "Choose the two guest colors.", 400);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["internalAccent", "embedAccent"].includes(key))) throw new PublicApiError("INVALID_REQUEST", "Unknown color setting.", 400);
  const color = (key: string) => {
    if (input[key] === null) return null;
    const result = normalizeGuestAccent(input[key]);
    if (!result) throw new PublicApiError("INVALID_REQUEST", "Use a six-digit hex color, such as #C99842, or choose MyDancr default.", 400);
    return result;
  };
  return { internalAccent: color("internalAccent"), embedAccent: color("embedAccent") };
}
