import type { SupabaseClient } from "@supabase/supabase-js";
import { CLUB_DEAL_OFFER_PRESETS } from "./club-deal-presets";

type DancrClient = SupabaseClient;
export type VenueClubDealRequestStatus = "pending" | "under_review" | "approved" | "rejected" | "withdrawn";

const REQUEST_COLUMNS = "id, venue_id, requested_by_user_id, offer_key, offer_title, request_notes, status, linked_deal_id, reviewed_by_admin_user_id, reviewed_at, decision_note, created_at, updated_at";
const OPEN_STATUSES: VenueClubDealRequestStatus[] = ["pending", "under_review"];

export async function getVenueClubDealRequests(client: DancrClient, venueId: string) {
  const { data, error } = await (client as any)
    .from("venue_club_deal_requests")
    .select(REQUEST_COLUMNS)
    .eq("venue_id", requiredUuid(venueId, "Venue is required."))
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []).map(toVenueClubDealRequest);
}

export async function getAdminVenueClubDealRequests(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("venue_club_deal_requests")
    .select(`${REQUEST_COLUMNS}, venues(id, name, slug, city, state)`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...toVenueClubDealRequest(row),
    venue: Array.isArray(row.venues) ? row.venues[0] || null : row.venues || null,
  }));
}

export async function createVenueClubDealRequest(
  client: DancrClient,
  input: { venueId: string; requestedByUserId: string; offerKey: string; requestNotes?: string | null },
) {
  const venueId = requiredUuid(input.venueId, "Venue is required.");
  const requestedByUserId = requiredUuid(input.requestedByUserId, "Venue user is required.");
  const preset = CLUB_DEAL_OFFER_PRESETS.find((candidate) => candidate.key === input.offerKey);
  if (!preset) throw new Error("Choose an approved admission offer.");
  const requestNotes = optionalText(input.requestNotes, "Request notes", 1000);

  const { count, error: countError } = await (client as any)
    .from("venue_club_deal_requests")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .in("status", OPEN_STATUSES);
  if (countError) throw countError;
  if (Number(count || 0) >= 5) {
    throw new Error("MyDancr is already reviewing five Club Deal requests for this venue.");
  }

  const { data, error } = await (client as any)
    .from("venue_club_deal_requests")
    .insert({
      venue_id: venueId,
      requested_by_user_id: requestedByUserId,
      offer_key: preset.key,
      offer_title: preset.title,
      request_notes: requestNotes,
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error) throw error;
  return toVenueClubDealRequest(data);
}

export async function reviewVenueClubDealRequest(
  client: DancrClient,
  input: {
    requestId: string;
    venueId: string;
    adminUserId: string;
    status: "under_review" | "approved" | "rejected";
    decisionNote?: string | null;
    linkedDealId?: string | null;
  },
) {
  const requestId = requiredUuid(input.requestId, "Club Deal request is required.");
  const venueId = requiredUuid(input.venueId, "Venue is required.");
  const adminUserId = requiredUuid(input.adminUserId, "Admin user is required.");
  const linkedDealId = input.linkedDealId ? requiredUuid(input.linkedDealId, "Linked Club Deal is invalid.") : null;
  const decisionNote = optionalText(input.decisionNote, "Decision note", 1000);
  const isFinal = input.status === "approved" || input.status === "rejected";
  if (input.status === "rejected" && !decisionNote) throw new Error("A rejection reason is required.");
  if (input.status === "approved" && !linkedDealId) throw new Error("Publish the linked Club Deal before approving this request.");

  const { data, error } = await (client as any)
    .from("venue_club_deal_requests")
    .update({
      status: input.status,
      linked_deal_id: linkedDealId,
      reviewed_by_admin_user_id: isFinal ? adminUserId : null,
      reviewed_at: isFinal ? new Date().toISOString() : null,
      decision_note: decisionNote,
    })
    .eq("id", requestId)
    .eq("venue_id", venueId)
    .in("status", ["pending", "under_review"])
    .select(REQUEST_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This Club Deal request is no longer available for review.");
  return toVenueClubDealRequest(data);
}

function toVenueClubDealRequest(row: any) {
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    requestedByUserId: row.requested_by_user_id ? String(row.requested_by_user_id) : null,
    offerKey: String(row.offer_key),
    offerTitle: String(row.offer_title),
    requestNotes: row.request_notes ? String(row.request_notes) : null,
    status: String(row.status) as VenueClubDealRequestStatus,
    linkedDealId: row.linked_deal_id ? String(row.linked_deal_id) : null,
    reviewedByAdminUserId: row.reviewed_by_admin_user_id ? String(row.reviewed_by_admin_user_id) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function optionalText(value: unknown, label: string, maximum: number) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return text;
}

function requiredUuid(value: unknown, message: string) {
  const text = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(message);
  }
  return text;
}
