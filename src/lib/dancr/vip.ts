import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { requireVenueAccess } from "./venue-access";
import type { VipState, VenueVipState, VipInvitation } from "./vip-types";

export const VIP_HEADERS = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };
const requestColumns = "id,venue_id,guest_name,starts_at,timezone,dancers,notes,status,response_note,created_at";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function vipId(value: unknown) {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new PublicApiError("INVALID_REQUEST", "Choose a valid venue or request.", 400);
  return value;
}
export function vipTokenDigest(value: unknown) {
  if (typeof value !== "string" || !/^vip_[A-Za-z0-9_-]{48}$/.test(value)) throw new PublicApiError("NOT_FOUND", "This VIP invitation is unavailable.", 404);
  return createHash("sha256").update(value).digest("hex");
}
export function newVipToken() { return `vip_${randomBytes(36).toString("base64url")}`; }
export function vipPage(search: URLSearchParams) {
  const page = Number(search.get("page") || 0);
  if (!Number.isInteger(page) || page < 0 || page > 1000) throw new PublicApiError("INVALID_REQUEST", "Invalid request page.", 400);
  return page;
}
export function vipError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "42501") return new PublicApiError("FORBIDDEN", "This account does not have VIP access for this venue. Use the invited customer email.", 403);
  if (code === "P0002") return new PublicApiError("NOT_FOUND", "This invitation, venue, or request is no longer available. Ask the venue for a new invitation if needed.", 404);
  if (code === "40001") return new PublicApiError("CONFLICT", "The request or dancer roster changed. Refresh and try again.", 409);
  if (code === "P0001") return new PublicApiError("INVALID_REQUEST", "Too many requests. Please wait before trying again.", 429);
  if (["22023", "22007", "22008", "22P02", "23514"].includes(code)) return new PublicApiError("INVALID_REQUEST", "Check the details. Choose 1–10 dancers and a future time within one year in the venue’s timezone.", 400);
  return error;
}

export async function requireVipManager(client: SupabaseClient, userId: string) {
  const access = await requireVenueAccess(client, userId, "manage_roster");
  const { data, error } = await client.rpc("vip_manager_access", { p_actor: userId, p_venue: access.venueId });
  if (error) throw error;
  if (data !== true) throw new PublicApiError("FORBIDDEN", "VIP management requires an active venue and an owner or manager account.", 403);
  return access;
}

export async function resolveVipInvitation(client: SupabaseClient, token: unknown): Promise<VipInvitation> {
  const { data, error } = await client.from("venue_vip_invitations")
    .select("email,expires_at,venue:venues!inner(name,is_active,owner:app_users!venues_owner_user_id_fkey(role,account_state))")
    .eq("token_digest", vipTokenDigest(token)).is("accepted_at", null).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  const venue = first(data?.venue);
  const owner = first(venue?.owner);
  if (!data || !venue?.is_active || owner?.role !== "venue" || owner.account_state !== "active") {
    throw new PublicApiError("NOT_FOUND", "This VIP invitation has expired, was used, or was revoked. Sign in to VIP or ask the venue for a new link.", 404);
  }
  const [local, domain] = data.email.split("@");
  return { venueName: venue.name, maskedEmail: `${local.slice(0, 1)}•••@${domain}`, expiresAt: data.expires_at };
}

export async function getVipState(client: SupabaseClient, userId: string, search: URLSearchParams): Promise<VipState> {
  const view = search.get("view");
  const filter = search.get("status") || "all";
  if ((view && !["overview", "plan", "requests", "account"].includes(view)) || !["all", "pending", "confirmed", "declined", "cancelled"].includes(filter)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a valid dashboard section or request status.", 400);
  }
  const { data: memberships, error } = await client.from("venue_vip_members")
    .select("venue_id,display_name,venue:venues!inner(id,name,timezone,is_active,owner:app_users!venues_owner_user_id_fkey(role,account_state))")
    .eq("user_id", userId).eq("active", true).order("created_at");
  if (error) throw error;
  const venues = (memberships || []).flatMap(member => {
    const venue = first(member.venue); const owner = first(venue?.owner);
    return venue?.is_active && owner?.role === "venue" && owner.account_state === "active"
      ? [{ id: venue.id as string, name: venue.name as string, timezone: venue.timezone as string, guestName: member.display_name as string }] : [];
  });
  const requested = search.get("venueId");
  const selected = requested ? venues.find(v => v.id === requested) : venues[0];
  if (requested && !selected) throw new PublicApiError("FORBIDDEN", "You do not have VIP access to this venue.", 403);
  if (!selected) return { venues, selectedVenueId: "", dancers: [], requests: [], hasMore: false };
  const base: VipState = { venues, selectedVenueId: selected.id, dancers: [], requests: [], hasMore: false };
  if (view === "account") return base;
  if (view === "overview") {
    const now = new Date().toISOString();
    const [pending, upcoming, nextVisit] = await Promise.all([
      client.from("venue_vip_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("venue_id", selected.id).eq("status", "pending"),
      client.from("venue_vip_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("venue_id", selected.id).eq("status", "confirmed").gt("starts_at", now),
      client.from("venue_vip_requests").select(requestColumns).eq("user_id", userId).eq("venue_id", selected.id).eq("status", "confirmed").gt("starts_at", now)
        .order("starts_at").order("id").limit(1),
    ]);
    for (const result of [pending, upcoming, nextVisit]) if (result.error) throw result.error;
    return { ...base, summary: { pending: pending.count || 0, upcoming: upcoming.count || 0, nextVisit: nextVisit.data?.[0] || null } };
  }
  if (view === "plan") {
    const { data, error } = await client.rpc("vip_eligible_dancers", { p_venue: selected.id });
    if (error) throw error;
    return { ...base, dancers: data || [] };
  }
  const page = vipPage(search);
  let requestQuery = client.from("venue_vip_requests").select(requestColumns, { count: "exact" }).eq("user_id", userId).eq("venue_id", selected.id);
  if (filter !== "all") requestQuery = requestQuery.eq("status", filter);
  const [roster, requests] = await Promise.all([
    view === "requests" ? Promise.resolve({ data: [], error: null }) : client.rpc("vip_eligible_dancers", { p_venue: selected.id }),
    requestQuery
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * 50, page * 50 + 50),
  ]);
  if (roster.error) throw roster.error; if (requests.error) throw requests.error;
  return { ...base, dancers: roster.data || [], requests: requests.data?.slice(0, 50) || [], hasMore: (requests.data?.length || 0) > 50, requestCount: requests.count || 0 };
}

export async function getVenueVipState(client: SupabaseClient, userId: string, search: URLSearchParams): Promise<VenueVipState> {
  const access = await requireVipManager(client, userId); const page = vipPage(search);
  const [invitations, members, requests] = await Promise.all([
    client.from("venue_vip_invitations").select("id,email,expires_at").eq("venue_id", access.venueId)
      .is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    client.from("venue_vip_members").select("id,display_name").eq("venue_id", access.venueId).eq("active", true).order("display_name"),
    client.from("venue_vip_requests").select(requestColumns).eq("venue_id", access.venueId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * 50, page * 50 + 50),
  ]);
  for (const result of [invitations, members, requests]) if (result.error) throw result.error;
  return { invitations: invitations.data || [], members: members.data || [], requests: requests.data?.slice(0, 50) || [], hasMore: (requests.data?.length || 0) > 50 };
}

// PostgREST represents to-one relationships as objects; test fixtures and some
// generated clients represent them as one-element arrays.
function first(value: unknown): Record<string, any> | null {
  return (Array.isArray(value) ? value[0] : value) as Record<string, any> | null;
}
