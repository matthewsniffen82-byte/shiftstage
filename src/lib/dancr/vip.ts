import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { requireVenueAccess } from "./venue-access";
import type { VipState, VenueVipState, VipInvitation, VipDancer } from "./vip-types";
import { dancerPhotoDeliveryUrl } from "./media-delivery-url";

export const VIP_HEADERS = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };
const requestColumns = "id,venue_id,guest_name,starts_at,timezone,dancers,notes,status,response_note,created_at,updated_at";
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
export function vipPage(search: URLSearchParams, key = "page") {
  const page = Number(search.get(key) || 0);
  if (!Number.isInteger(page) || page < 0 || page > 1000) throw new PublicApiError("INVALID_REQUEST", "Invalid request page.", 400);
  return page;
}
export function vipNickname(value: unknown) {
  if (typeof value !== "string" || value.trim().length > 80 || /\p{Cc}/u.test(value)) {
    throw new PublicApiError("INVALID_REQUEST", "Use a nickname of 80 characters or fewer, without line breaks.", 400);
  }
  return value.trim();
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
  if ((view && !["overview", "dancers", "plan", "requests", "account"].includes(view)) || !["all", "pending", "confirmed", "declined", "cancelled"].includes(filter)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a valid dashboard section or request status.", 400);
  }
  const { data: memberships, error } = await client.from("venue_vip_members")
    .select("venue_id,display_name,nickname,venue:venues!inner(id,name,timezone,is_active,owner:app_users!venues_owner_user_id_fkey(role,account_state))")
    .eq("user_id", userId).eq("active", true).order("created_at");
  if (error) throw error;
  const venues = (memberships || []).flatMap(member => {
    const venue = first(member.venue); const owner = first(venue?.owner);
    return venue?.is_active && owner?.role === "venue" && owner.account_state === "active"
      ? [{ id: venue.id as string, name: venue.name as string, timezone: venue.timezone as string, guestName: member.display_name as string, nickname: member.nickname as string }] : [];
  });
  const requested = search.get("venueId");
  const selected = requested ? venues.find(v => v.id === requested) : venues[0];
  if (requested && !selected) throw new PublicApiError("FORBIDDEN", "You do not have VIP access to this venue.", 403);
  if (!selected) return { venues, selectedVenueId: "", dancers: [], requests: [], hasMore: false };
  const base: VipState = { venues, selectedVenueId: selected.id, dancers: [], requests: [], hasMore: false };
  if (view === "account") return base;
  if (view === "dancers") return { ...base, dancers: await vipMyDancers(client, userId, selected.id) };
  if (view === "overview") {
    const now = new Date().toISOString();
    const [pending, upcoming, nextVisit, dancers] = await Promise.all([
      client.from("venue_vip_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("venue_id", selected.id).eq("status", "pending"),
      client.from("venue_vip_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("venue_id", selected.id).eq("status", "confirmed").gt("starts_at", now),
      client.from("venue_vip_requests").select(requestColumns).eq("user_id", userId).eq("venue_id", selected.id).eq("status", "confirmed").gt("starts_at", now)
        .order("starts_at").order("id").limit(1),
      vipWorkingFavorites(client, userId, selected.id),
    ]);
    for (const result of [pending, upcoming, nextVisit]) if (result.error) throw result.error;
    return { ...base, dancers, summary: { pending: pending.count || 0, upcoming: upcoming.count || 0, nextVisit: nextVisit.data?.[0] || null } };
  }
  if (view === "plan") {
    const { data, error } = await client.rpc("vip_eligible_dancers", { p_venue: selected.id });
    if (error) throw error;
    return { ...base, dancers: await vipDancerCards(client, data || [], userId, selected.id) };
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
  const status = search.get("status") || "all";
  if (!["all", "pending"].includes(status)) throw new PublicApiError("INVALID_REQUEST", "Choose a valid request status.", 400);
  const memberPage = vipPage(search, "memberPage");
  const memberSearch = vipNickname(search.get("memberSearch") || "");
  let requestQuery = client.from("venue_vip_requests").select(`${requestColumns},user_id`, { count: "exact" }).eq("venue_id", access.venueId);
  if (status === "pending") requestQuery = requestQuery.eq("status", "pending");
  const [invitations, members, requests] = await Promise.all([
    client.from("venue_vip_invitations").select("id,email,nickname,expires_at").eq("venue_id", access.venueId)
      .is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    client.rpc("vip_search_members", { p_actor: userId, p_venue: access.venueId, p_search: memberSearch, p_offset: memberPage * 50 }),
    requestQuery
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * 50, page * 50 + 50),
  ]);
  for (const result of [invitations, members, requests]) if (result.error) throw result.error;
  const requestPage = requests.data?.slice(0, 50) || [];
  const userIds = [...new Set(requestPage.map(request => request.user_id))];
  const labels = userIds.length ? await client.from("venue_vip_members").select("user_id,nickname")
    .eq("venue_id", access.venueId).in("user_id", userIds) : { data: [], error: null };
  if (labels.error) throw labels.error;
  const nicknames = new Map((labels.data || []).map(member => [member.user_id, member.nickname]));
  const namedRequests = requestPage.map(({ user_id, ...request }) => ({ ...request, nickname: nicknames.get(user_id) || "" }));
  return { invitations: invitations.data || [], members: members.data?.members || [], memberCount: members.data?.memberCount || 0,
    membersHasMore: members.data?.membersHasMore || false, requests: namedRequests, hasMore: (requests.data?.length || 0) > 50, requestCount: requests.count || 0 };
}

async function vipWorkingFavorites(client: SupabaseClient, userId: string, venueId: string): Promise<VipDancer[]> {
  const [favorites, follows] = await Promise.all([
    savedDancerIds(client, "favorites", userId), savedDancerIds(client, "follows", userId),
  ]);
  if (!favorites.size) return [];
  const { data: roster, error } = await client.rpc("vip_eligible_dancers", { p_venue: venueId });
  if (error) throw error;
  const dancers = (roster as VipDancer[] || []).filter(dancer => dancer.working_now && favorites.has(dancer.id))
    .sort((a, b) => a.stage_name.localeCompare(b.stage_name, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id)).slice(0, 4);
  if (!dancers.length) return [];
  const { data: profiles, error: profileError } = await client.from("dancer_profiles").select("id,slug,avatar_storage_path")
    .in("id", dancers.map(dancer => dancer.id)).eq("status", "approved").eq("verification_status", "approved").eq("is_public", true).is("disabled_at", null);
  if (profileError) throw profileError;
  const publicProfiles = new Map((profiles || []).map(profile => [profile.id, profile]));
  return dancers.map(dancer => {
    const profile = publicProfiles.get(dancer.id), path = profile?.avatar_storage_path;
    return { ...dancer, favorite: favorites.has(dancer.id), following: follows.has(dancer.id), canRequest: true,
      profileHref: profile?.slug ? `/dancers/${encodeURIComponent(profile.slug)}` : null,
      photoUrl: path && !/^https?:\/\//i.test(path) ? dancerPhotoDeliveryUrl(path, 320) : null };
  });
}

async function vipMyDancers(client: SupabaseClient, userId: string, venueId: string): Promise<VipDancer[]> {
  // Membership is verified by getVipState before any private collection is read.
  const [favorites, follows, history, roster, alerts] = await Promise.all([
    savedDancerIds(client, "favorites", userId),
    savedDancerIds(client, "follows", userId),
    requestedDancerHistory(client, userId, venueId),
    client.rpc("vip_eligible_dancers", { p_venue: venueId }),
    vipWorkingAlertIds(client, userId, venueId),
  ]);
  if (roster.error) throw roster.error;
  const eligible = new Map<string, VipDancer>((roster.data || []).map((dancer: VipDancer) => [dancer.id, dancer]));
  const ids = [...new Set([...eligible.keys(), ...history.keys(), ...favorites, ...follows, ...alerts])];
  const profiles = new Map<string, { slug: string; stage_name: string; avatar_storage_path: string | null }>();
  // Bound URL size and avoid the database's default result limit.
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await client.from("dancer_profiles").select("id,slug,stage_name,avatar_storage_path")
      .in("id", ids.slice(offset, offset + 200)).eq("status", "approved").eq("verification_status", "approved")
      .eq("is_public", true).is("disabled_at", null);
    if (error) throw error;
    for (const profile of data || []) profiles.set(profile.id, profile);
  }
  return ids.map(id => {
    const profile = profiles.get(id), dancer = eligible.get(id), path = profile?.avatar_storage_path;
    return { id, stage_name: profile?.stage_name || dancer?.stage_name || history.get(id) || "Unavailable dancer",
      working_now: dancer?.working_now === true, canRequest: eligible.has(id),
      favorite: favorites.has(id), following: follows.has(id), previouslyRequested: history.has(id),
      workingAlertsEnabled: alerts.has(id),
      profileHref: profile?.slug ? `/dancers/${encodeURIComponent(profile.slug)}` : null,
      photoUrl: path && !/^https?:\/\//i.test(path) ? dancerPhotoDeliveryUrl(path, 320) : null };
  });
}

async function vipWorkingAlertIds(client: SupabaseClient, userId: string, venueId: string) {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("venue_vip_working_alerts").select("dancer_id")
      .eq("user_id", userId).eq("venue_id", venueId).order("dancer_id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data || []) ids.add(row.dancer_id);
    if (!data || data.length < 500) return ids;
  }
}

async function savedDancerIds(client: SupabaseClient, table: "favorites" | "follows", userId: string) {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from(table).select("dancer_id").eq("customer_id", userId)
      .order("dancer_id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data || []) ids.add(row.dancer_id);
    if (!data || data.length < 500) return ids;
  }
}

async function requestedDancerHistory(client: SupabaseClient, userId: string, venueId: string) {
  const dancers = new Map<string, string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("venue_vip_requests").select("id,dancers")
      .eq("user_id", userId).eq("venue_id", venueId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
    if (error) throw error;
    for (const request of data || []) for (const dancer of Array.isArray(request.dancers) ? request.dancers : []) {
      if (typeof dancer?.id === "string" && !dancers.has(dancer.id)) dancers.set(dancer.id, typeof dancer.stageName === "string" ? dancer.stageName : "Unavailable dancer");
    }
    if (!data || data.length < 500) return dancers;
  }
}

async function vipDancerCards(client: SupabaseClient, dancers: VipDancer[], userId: string, venueId: string): Promise<VipDancer[]> {
  if (!dancers.length) return [];
  const ids = dancers.map(dancer => dancer.id);
  const [profiles, favorites, previous] = await Promise.all([
    client.from("dancer_profiles").select("id,slug,avatar_storage_path")
      .in("id", ids).eq("status", "approved").eq("verification_status", "approved").eq("is_public", true).is("disabled_at", null),
    client.from("favorites").select("dancer_id").eq("customer_id", userId).in("dancer_id", ids),
    previouslyRequestedDancers(client, userId, venueId, new Set(ids)),
  ]);
  if (profiles.error) throw profiles.error;
  if (favorites.error) throw favorites.error;
  const publicProfiles = new Map((profiles.data || []).map(row => [row.id, row]));
  const saved = new Set((favorites.data || []).map(row => row.dancer_id));
  return dancers.map(dancer => {
    const profile = publicProfiles.get(dancer.id), path = profile?.avatar_storage_path;
    // The existing photo endpoint checks current anonymous RLS on every image.
    return { ...dancer, photoUrl: path && !/^https?:\/\//i.test(path) ? dancerPhotoDeliveryUrl(path, 320) : null,
      profileHref: profile?.slug ? `/dancers/${encodeURIComponent(profile.slug)}` : null,
      favorite: saved.has(dancer.id), previouslyRequested: previous.has(dancer.id) };
  });
}

async function previouslyRequestedDancers(client: SupabaseClient, userId: string, venueId: string, eligible: Set<string>) {
  const found = new Set<string>();
  // Read all history in bounded pages, including requests older than the first
  // dashboard page. Only the current venue's requestable roster is returned.
  for (let offset = 0; found.size < eligible.size; offset += 500) {
    const { data, error } = await client.from("venue_vip_requests").select("id,dancers")
      .eq("user_id", userId).eq("venue_id", venueId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
    if (error) throw error;
    for (const request of data || []) for (const dancer of Array.isArray(request.dancers) ? request.dancers : []) {
      if (typeof dancer?.id === "string" && eligible.has(dancer.id)) found.add(dancer.id);
    }
    if (!data || data.length < 500) break;
  }
  return found;
}

// PostgREST represents to-one relationships as objects; test fixtures and some
// generated clients represent them as one-element arrays.
function first(value: unknown): Record<string, any> | null {
  return (Array.isArray(value) ? value[0] : value) as Record<string, any> | null;
}
