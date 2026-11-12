import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import type { DancerPendingRequestSummary, DancerRequestChannel, DancerRequestPage, DancerRequestStatus } from "./dancer-request-types";

const PAGE_SIZE = 20;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
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
  // Preserve the exact database window, including Postgres microseconds and
  // offsets. Converting through Date would discard sub-millisecond precision.
  return { channel, since, until, venueId, pending: pending === "true", offset: Number(offset) };
}

type Relation<T> = T | T[] | null;
type RequestRow = {
  id: string; created_at: string; status: DancerRequestStatus; starts_at?: string; timezone?: string;
  venues: Relation<{ name: string; timezone: string }>;
  internal_roster_links?: Relation<{ label: string }>;
};
const first = <T,>(value: Relation<T> | undefined) => Array.isArray(value) ? value[0] : value;

async function ownDancerId(admin: SupabaseClient, userId: string): Promise<string> {
  const profile = await admin.from("dancer_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) throw new PublicApiError("NOT_FOUND", "Dancer profile not found.", 404);
  return profile.data.id;
}

export async function getOwnPendingRequestSummary(admin: SupabaseClient, userId: string): Promise<DancerPendingRequestSummary> {
  const dancerId = await ownDancerId(admin, userId);
  const now = Date.now();
  const until = new Date(now).toISOString();
  // Match the six-hour club table queue. A pending VIP visit can be booked further ahead.
  const tableSince = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const vipSince = new Date(0).toISOString();
  const countOnly = { count: "exact", head: true } as const;
  const [table, vip] = await Promise.all([
    admin.from("internal_roster_requests").select("id", countOnly).eq("dancer_id", dancerId)
      .eq("status", "pending").gte("created_at", tableSince).lt("created_at", until),
    admin.from("venue_vip_requests").select("id", countOnly).contains("dancers", JSON.stringify([{ id: dancerId }]))
      .eq("status", "pending").gte("created_at", vipSince).lt("created_at", until),
  ]);
  if (table.error) throw table.error;
  if (vip.error) throw vip.error;
  if (table.count === null || vip.count === null) throw new Error("Request counts unavailable.");
  return { table: table.count, vip: vip.count, tableSince, vipSince, until };
}

// The route authenticates the dancer before constructing the privileged client.
export async function getOwnDancerRequests(admin: SupabaseClient, userId: string, query: RequestQuery): Promise<DancerRequestPage> {
  const dancerId = await ownDancerId(admin, userId);

  // Deliberately exclude guest identities, private notes, access tokens and the
  // other dancers included in a VIP visit. Only return this dancer's requests.
  let read = query.channel === "internal"
    ? admin.from("internal_roster_requests").select("id, created_at, status, venues(name, timezone), internal_roster_links(label)").eq("dancer_id", dancerId)
    : admin.from("venue_vip_requests").select("id, created_at, status, starts_at, timezone, venues(name, timezone)").contains("dancers", JSON.stringify([{ id: dancerId }]));
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
