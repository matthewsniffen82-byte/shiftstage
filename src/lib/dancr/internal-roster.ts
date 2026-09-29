import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { requireVenueAccess } from "./venue-access";
import { createRequestSupabaseContext } from "../supabase/request";

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
    const { data: link, error } = await client.from("internal_roster_links").select("id,venue_id,kind,label").eq("token", token).eq("active", true).eq("kind", "table").maybeSingle();
    if (error) throw error;
    if (!link) throw new PublicApiError("NOT_FOUND", "This club link has been revoked or is unavailable.", 404);
    const { data: venue, error: venueError } = await client.from("venues").select("id,name,owner_user_id").eq("id", link.venue_id).eq("is_active", true).maybeSingle();
    if (venueError) throw venueError;
    const { data: owner, error: ownerError } = await client.from("app_users").select("id").eq("id", venue?.owner_user_id || "00000000-0000-4000-8000-000000000000").eq("role", "venue").eq("account_state", "active").maybeSingle();
    if (ownerError) throw ownerError;
    if (!venue || !owner) throw new PublicApiError("NOT_FOUND", "This club link is unavailable.", 404);
    return { venueId: venue.id as string, venueName: venue.name as string, userId: null, role: null, session: null, link };
  }
  const auth = await createRequestSupabaseContext(request, { role: "venue" });
  const access = await requireVenueAccess(client, auth.user.id, "view_roster");
  return { venueId: access.venueId, venueName: access.venueName, userId: auth.user.id, role: access.role, session: auth.session || null, link: null };
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
