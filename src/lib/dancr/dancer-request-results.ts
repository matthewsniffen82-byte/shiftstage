import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import type { DancerRequestChannel, DancerRequestPage, DancerRequestStatus } from "./dancer-request-types";

const PAGE_SIZE = 20;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
type RequestQuery = { channel: DancerRequestChannel; since: string; until: string; venueId: string | null; pending: boolean; offset: number };

export function parseDancerRequestQuery(params: URLSearchParams, now = Date.now()): RequestQuery {
  const channel = params.get("channel"), since = params.get("since") || "", until = params.get("until") || "";
  const venueId = params.get("venueId"), pending = params.get("pending") || "false", offset = params.get("offset") || "0";
  if ((channel !== "internal" && channel !== "vip") || !timestamp.test(since) || !timestamp.test(until)
    || !Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until))
    || Date.parse(since) >= Date.parse(until) || Date.parse(until) > now + 60_000
    || (venueId !== null && !uuid.test(venueId)) || !["true", "false"].includes(pending)
    || !/^\d{1,6}$/.test(offset)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a valid request channel, period and club.", 400);
  }
  return { channel, since: new Date(since).toISOString(), until: new Date(until).toISOString(), venueId, pending: pending === "true", offset: Number(offset) };
}

type Relation<T> = T | T[] | null;
type RequestRow = {
  id: string; created_at: string; status: DancerRequestStatus; starts_at?: string; timezone?: string;
  venues: Relation<{ name: string; timezone: string }>;
  internal_roster_links?: Relation<{ label: string }>;
};
const first = <T,>(value: Relation<T> | undefined) => Array.isArray(value) ? value[0] : value;

// The route authenticates the dancer before constructing the privileged client.
// Always derive ownership from that verified user; never accept a dancer ID.
export async function getOwnDancerRequests(admin: SupabaseClient, userId: string, query: RequestQuery): Promise<DancerRequestPage> {
  const profile = await admin.from("dancer_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) throw new PublicApiError("NOT_FOUND", "Dancer profile not found.", 404);

  // Deliberately exclude guest identities, private notes, access tokens and the
  // other dancers included in a VIP visit. Only return this dancer's requests.
  let read = query.channel === "internal"
    ? admin.from("internal_roster_requests").select("id, created_at, status, venues(name, timezone), internal_roster_links(label)").eq("dancer_id", profile.data.id)
    : admin.from("venue_vip_requests").select("id, created_at, status, starts_at, timezone, venues(name, timezone)").contains("dancers", JSON.stringify([{ id: profile.data.id }]));
  // Match analytics by submission time (including cancelled requests), not the
  // scheduled visit time. Status reflects the latest staff decision.
  read = read.gte("created_at", query.since).lt("created_at", query.until);
  if (query.venueId) read = read.eq("venue_id", query.venueId);
  if (query.pending) read = read.eq("status", "pending");
  const { data, error } = await read.order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(query.offset, query.offset + PAGE_SIZE);
  if (error) throw error;
  const rows = (data || []) as unknown as RequestRow[];
  return {
    items: rows.slice(0, PAGE_SIZE).map(row => ({
      id: row.id, label: query.channel === "vip" ? "VIP visit" : first(row.internal_roster_links)?.label || "Table request",
      venueName: first(row.venues)?.name || "Club", createdAt: row.created_at,
      startsAt: query.channel === "vip" ? row.starts_at || null : null,
      timezone: row.timezone || first(row.venues)?.timezone || "UTC", status: row.status,
    })),
    nextOffset: rows.length > PAGE_SIZE ? query.offset + PAGE_SIZE : null,
  };
}
