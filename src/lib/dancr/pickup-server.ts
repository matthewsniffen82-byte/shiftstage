import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { PICKUP_ACTIVE_STATUSES, PICKUP_STATUS_LABELS, type PickupDetail, type PickupRequest, type PickupRole } from "./pickup-domain";
import { pickupDate, pickupPageOffset, pickupUuid } from "./pickup-validation";

const REQUEST_COLUMNS = "id,customer_user_id,venue_id,status,party_size,pickup_location_text,pickup_location_details,customer_notes,requested_at,expires_at,accepted_at,vehicle_dispatched_at,arrived_at,completed_at,cancelled_at,cancellation_reason,referral_source,referral_outcome,updated_at,venue:venues(name,slug)";
export async function pickupRpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throwPickupError(error);
  return data;
}
export async function pickupAccountRole(client: SupabaseClient): Promise<PickupRole> {
  const role = await pickupRpc(client, "pickup_actor_role");
  if (!["customer", "venue", "admin"].includes(role)) throw new PublicApiError("FORBIDDEN", "Club Pickup is available to customers and authorized venue managers.", 403);
  return role;
}
export async function listPickups(client: SupabaseClient, search: URLSearchParams) {
  const role = await pickupAccountRole(client);
  await pickupRpc(client, "pickup_expire_requests");
  const offset = pickupPageOffset(search.get("offset"));
  let query = client.from("pickup_requests").select(REQUEST_COLUMNS).order("requested_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 30);
  const group = search.get("group") || "active", status = search.get("status");
  if (status) {
    if (!Object.hasOwn(PICKUP_STATUS_LABELS, status)) throw new PublicApiError("INVALID_REQUEST", "Invalid status filter.", 400);
    query = query.eq("status", status);
  } else if (group === "active") query = query.in("status", PICKUP_ACTIVE_STATUSES);
  else if (group === "completed") query = query.eq("status", "completed");
  else if (group === "closed") query = query.in("status", ["cancelled", "no_show", "expired"]);
  else if (group !== "all") throw new PublicApiError("INVALID_REQUEST", "Invalid pickup group.", 400);
  const venue = search.get("venueId");
  if (venue) query = query.eq("venue_id", pickupUuid(venue));
  const from = pickupDate(search.get("from")), to = pickupDate(search.get("to"));
  if (from) query = query.gte("requested_at", from + "T00:00:00Z");
  if (to) query = query.lt("requested_at", new Date(Date.parse(to) + 86400000).toISOString());
  const { data, error } = await query;
  if (error) throwPickupError(error);
  const rows = (data || []).slice(0, 30) as unknown as PickupRequest[];
  const counts = rows.length ? await pickupRpc(client, "pickup_unread_counts", { p_ids: rows.map(row => row.id) }) : [];
  const unread = new Map<string, number>(counts.map((row: { request_id: string; unread_count: number }) => [row.request_id, Number(row.unread_count)]));
  return { role, requests: rows.map(row => ({ ...row, unread_count: unread.get(row.id) || 0 })), hasMore: (data?.length || 0) > 30 };
}
export async function getPickup(client: SupabaseClient, id: string, search: URLSearchParams): Promise<PickupDetail> {
  pickupUuid(id);
  const role = await pickupRpc(client, "pickup_viewer", { p_request_id: id }) as PickupRole | null;
  if (!role) throw new PublicApiError("NOT_FOUND", "Pickup conversation not found.", 404);
  await pickupRpc(client, "pickup_expire_requests");
  const { data, error } = await client.from("pickup_requests").select(REQUEST_COLUMNS).eq("id", id).maybeSingle();
  if (error) throwPickupError(error);
  if (!data) throw new PublicApiError("NOT_FOUND", "Pickup conversation not found.", 404);
  const consented = role === "admin" || Boolean(await pickupRpc(client, "pickup_has_consent", { p_request_id: id }));
  let messageQuery = client.from("pickup_messages").select("id,sequence,sender_type,message_text,created_at")
    .eq("pickup_request_id", id).order("sequence", { ascending: false }).limit(51);
  const before = search.get("before");
  if (before) {
    if (!/^\d{1,16}$/.test(before) || !Number.isSafeInteger(Number(before))) throw new PublicApiError("INVALID_REQUEST", "Invalid message position.", 400);
    messageQuery = messageQuery.lt("sequence", Number(before));
  }
  const eventOffset = pickupPageOffset(search.get("eventOffset"));
  const [messages, events, reports, evidence] = await Promise.all([
    consented ? messageQuery : Promise.resolve({ data: [], error: null }),
    role === "admin" ? client.from("pickup_events").select("id,event_type,actor_user_id,metadata,created_at").eq("pickup_request_id", id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(eventOffset, eventOffset + 100) : Promise.resolve({ data: [], error: null }),
    role === "admin" ? client.from("pickup_reports").select("id,reporter_user_id,reason,details,created_at").eq("pickup_request_id", id).order("created_at").limit(200) : Promise.resolve({ data: [], error: null }),
    client.from("pickup_arrival_evidence").select("id,source,actor_user_id,redemption_id,created_at").eq("pickup_request_id", id).order("created_at").limit(10),
  ]);
  for (const result of [messages, events, reports, evidence]) if (result.error) throwPickupError(result.error);
  return { request: data as unknown as PickupRequest, role, consented, messages: (messages.data || []).slice(0, 50).reverse(),
    hasOlderMessages: (messages.data?.length || 0) > 50, events: (events.data || []).slice(0, 100),
    hasMoreEvents: (events.data?.length || 0) > 100, reports: reports.data || [], evidence: evidence.data || [] };
}
export function throwPickupError(error: { code?: string }) : never {
  if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "You do not have permission for this pickup action. Check your account and chat consent.", 403);
  if (error.code === "22023" || error.code === "23514") throw new PublicApiError("INVALID_REQUEST", "Check your details. This venue or pickup may no longer be accepting that action.", 400);
  if (error.code === "40001" || error.code === "23505") throw new PublicApiError("CONFLICT", "This pickup changed. Refresh and check its current status before trying again.", 409);
  if (error.code === "P0001") throw new PublicApiError("CONFLICT", "Too many pickup requests or messages. Please wait before trying again.", 429);
  throw new PublicApiError("UNAVAILABLE", "Pickup is temporarily unavailable. Check the current conversation before retrying.", 503);
}
