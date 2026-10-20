import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { requireVenueAccess } from "./venue-access";
import { createRequestSupabaseContext } from "../supabase/request";
import { responsivePublicImage } from "./responsive-image";
import { verifiedVenueLogoUrl } from "./venue-branding";

export const INTERNAL_HEADERS = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
export const isInternalUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export type InternalMember = { id: string; stage_name: string; avatar_storage_path: string; working_until: string };

export async function internalMembers(client: SupabaseClient, venueId: string): Promise<InternalMember[]> {
  const { data, error } = await client.rpc("internal_roster_members", { p_venue_id: venueId });
  if (error) throw error;
  return data || [];
}

export type VenueRosterMember = Omit<InternalMember, "working_until"> & { working_until: string | null; internal_visible: boolean; external_visible: boolean };
export async function venueRosterMembers(client: SupabaseClient, venueId: string): Promise<VenueRosterMember[]> {
  const { data, error } = await client.rpc("venue_roster_members", { p_venue_id: venueId });
  if (error) throw error;
  return data || [];
}

export async function internalScope(client: SupabaseClient, request: Request, token?: string) {
  if (token !== undefined) {
    if (!isInternalUuid(token)) throw new PublicApiError("NOT_FOUND", "This club link is unavailable.", 404);
    // Check the link, live club and active owner in one fresh database read.
    const { data, error } = await client.from("internal_roster_links").select(`id,venue_id,kind,label,
      venue:venues!internal_roster_links_venue_id_fkey!inner(id,name,slug,logo_storage_path,is_active,
        owner:app_users!venues_owner_user_id_fkey!inner(id,role,account_state))`)
      .eq("token", token).eq("active", true).eq("kind", "table").maybeSingle();
    if (error) throw error;
    type Owner = { id: string; role: string; account_state: string };
    type Venue = { id: string; name: string; slug: string; logo_storage_path: string | null; is_active: boolean; owner: Owner | Owner[] | null };
    const row = data as unknown as { id: string; venue_id: string; kind: string; label: string; venue: Venue | Venue[] | null } | null;
    const venue = Array.isArray(row?.venue) ? row.venue[0] : row?.venue;
    const owner = Array.isArray(venue?.owner) ? venue.owner[0] : venue?.owner;
    if (!row || !venue?.is_active || !owner || owner.role !== "venue" || owner.account_state !== "active") {
      throw new PublicApiError("NOT_FOUND", "This club link has been revoked or is unavailable.", 404);
    }
    const link = { id: row.id, venue_id: row.venue_id, kind: row.kind, label: row.label };
    const venueLogoUrl = responsivePublicImage(client, "venue-logo-images", venue.logo_storage_path)?.imageUrl || verifiedVenueLogoUrl(venue.slug);
    return { venueId: venue.id as string, venueName: venue.name as string, venueSlug: venue.slug as string, venueLogoUrl, userId: null, role: null, session: null, link };
  }
  const auth = await createRequestSupabaseContext(request, { role: "venue" });
  const access = await requireVenueAccess(client, auth.user.id, "view_roster");
  return { venueId: access.venueId, venueName: access.venueName, venueSlug: access.venueSlug, userId: auth.user.id, role: access.role, session: auth.session || null, link: null };
}

export function internalError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "42501") return new PublicApiError("FORBIDDEN", "Your club access is unavailable. Sign in again or ask a manager.", 403);
  if (code === "40001") return new PublicApiError("CONFLICT", "This request or dancer’s availability changed. Refresh and try again.", 409);
  if (code === "P0001") return new PublicApiError("INVALID_REQUEST", "Please wait before sending another request. Staff may already be handling your table’s requests.", 429);
  if (["22023", "22P02", "23514"].includes(code)) return new PublicApiError("INVALID_REQUEST", "Check the request details and try again.", 400);
  if (code === "P0002") return new PublicApiError("NOT_FOUND", "This item is no longer available.", 404);
  return error;
}
