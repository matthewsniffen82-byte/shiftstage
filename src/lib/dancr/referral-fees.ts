import type { SupabaseClient } from "@supabase/supabase-js";
import { requireVenueAccess } from "./venue-access";

type DancrClient = SupabaseClient;

export type VenueReferralFeeTerm = {
  id: string;
  venueId: string;
  feeCents: number;
  currency: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  agreementReference: string;
  decisionNote: string | null;
  createdByAdminUserId: string;
  supersededAt: string | null;
  createdAt: string;
};

export type VenueReferralFeeChangeRequest = {
  id: string;
  venueId: string;
  requestedFeeCents: number;
  currency: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedByUserId: string;
  reviewedByAdminUserId: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VenueReferralFeeState = {
  current: VenueReferralFeeTerm | null;
  scheduled: VenueReferralFeeTerm[];
  history: VenueReferralFeeTerm[];
  requests: VenueReferralFeeChangeRequest[];
};

const TERM_COLUMNS = "id, venue_id, fee_cents, currency, effective_from, effective_until, agreement_reference, decision_note, created_by_admin_user_id, superseded_at, created_at";
const REQUEST_COLUMNS = "id, venue_id, requested_fee_cents, currency, reason, status, requested_by_user_id, reviewed_by_admin_user_id, reviewed_at, decision_note, created_at, updated_at";

export async function getVenueReferralFeeState(
  client: DancrClient,
  venueId: string,
): Promise<VenueReferralFeeState> {
  const db = client as any;
  const [{ data: terms, error: termsError }, { data: requests, error: requestsError }] = await Promise.all([
    db
      .from("venue_referral_fee_terms")
      .select(TERM_COLUMNS)
      .eq("venue_id", venueId)
      .order("effective_from", { ascending: false })
      .limit(100),
    db
      .from("venue_referral_fee_change_requests")
      .select(REQUEST_COLUMNS)
      .eq("venue_id", venueId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (termsError) throw termsError;
  if (requestsError) throw requestsError;

  const now = Date.now();
  const history: VenueReferralFeeTerm[] = (terms || []).map((term: any) => toReferralFeeTerm(term));
  const current = history.find((term) => (
    !term.supersededAt
    &&
    Date.parse(term.effectiveFrom) <= now
    && (!term.effectiveUntil || Date.parse(term.effectiveUntil) > now)
  )) || null;
  const scheduled = history
    .filter((term) => !term.supersededAt && Date.parse(term.effectiveFrom) > now && !term.effectiveUntil)
    .sort((left, right) => Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom));

  return {
    current,
    scheduled,
    history,
    requests: (requests || []).map(toReferralFeeRequest),
  };
}

export async function getVenueReferralFeeStateForAccount(
  client: DancrClient,
  userId: string,
) {
  const access = await requireVenueAccess(client, userId, "view_deals");
  return getVenueReferralFeeState(client, access.venueId);
}

export async function getAdminReferralFeeState(client: DancrClient) {
  const db = client as any;
  const [{ data: terms, error: termsError }, { data: requests, error: requestsError }] = await Promise.all([
    db
      .from("venue_referral_fee_terms")
      .select(TERM_COLUMNS)
      .order("effective_from", { ascending: false })
      .limit(1000),
    db
      .from("venue_referral_fee_change_requests")
      .select(REQUEST_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (termsError) throw termsError;
  if (requestsError) throw requestsError;
  return {
    terms: (terms || []).map(toReferralFeeTerm),
    requests: (requests || []).map(toReferralFeeRequest),
  };
}

export async function requireCurrentVenueReferralFee(client: DancrClient, venueId: string) {
  const state = await getVenueReferralFeeState(client, venueId);
  if (!state.current) {
    throw new Error("A MyDancr referral fee agreement is required before publishing a Club Deal.");
  }
  return state.current;
}

export async function requestVenueReferralFeeChange(
  client: DancrClient,
  userId: string,
  input: { requestedFeeCents: number; reason: string },
) {
  const db = client as any;
  const access = await requireVenueAccess(client, userId, "manage_deals");
  const requestedFeeCents = validFeeCents(input.requestedFeeCents);
  const reason = requiredText(input.reason, "Explain why the referral fee should change.", 10, 500);

  const { data: pending, error: pendingError } = await db
    .from("venue_referral_fee_change_requests")
    .select("id")
    .eq("venue_id", access.venueId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingError) throw pendingError;
  if (pending) throw new Error("This venue already has a referral fee change request awaiting review.");

  const { data, error } = await db
    .from("venue_referral_fee_change_requests")
    .insert({
      venue_id: access.venueId,
      requested_fee_cents: requestedFeeCents,
      currency: "usd",
      reason,
      requested_by_user_id: userId,
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (error?.code === "23505") {
    throw new Error("This venue already has a referral fee change request awaiting review.");
  }
  if (error) throw error;
  return toReferralFeeRequest(data);
}

export async function setAdminVenueReferralFee(
  client: DancrClient,
  adminId: string,
  input: {
    venueId: string;
    feeCents: number;
    effectiveFrom: string;
    agreementReference: string;
    decisionNote?: string | null;
    requestId?: string | null;
  },
) {
  const venueId = requiredUuid(input.venueId, "A venue is required.");
  const feeCents = validFeeCents(input.feeCents);
  const effectiveFrom = validEffectiveDate(input.effectiveFrom);
  const agreementReference = requiredText(input.agreementReference, "Agreement reference is required.", 3, 160);
  const decisionNote = optionalText(input.decisionNote, 500);
  const requestId = input.requestId ? requiredUuid(input.requestId, "The fee change request is invalid.") : null;
  const { data, error } = await (client as any).rpc("set_admin_venue_referral_fee", {
    p_admin_id: adminId,
    p_venue_id: venueId,
    p_fee_cents: feeCents,
    p_currency: "usd",
    p_effective_from: effectiveFrom,
    p_agreement_reference: agreementReference,
    p_decision_note: decisionNote,
    p_request_id: requestId,
  });
  if (error) throw error;
  const termId = typeof data === "string" ? data : String(data || "");
  if (!termId) throw new Error("The referral fee agreement could not be saved.");
  return { termId, state: await getAdminReferralFeeState(client) };
}

export async function rejectAdminVenueReferralFeeRequest(
  client: DancrClient,
  adminId: string,
  requestId: string,
  decisionNote: string,
) {
  const id = requiredUuid(requestId, "The fee change request is invalid.");
  const note = requiredText(decisionNote, "Add a reason before rejecting this request.", 3, 500);
  const { data, error } = await (client as any).rpc("reject_admin_venue_referral_fee_request", {
    p_admin_id: adminId,
    p_request_id: id,
    p_decision_note: note,
  });
  if (error) throw error;
  if (String(data || "") !== id) throw new Error("The fee change request could not be rejected.");
  return { state: await getAdminReferralFeeState(client) };
}

function toReferralFeeTerm(row: any): VenueReferralFeeTerm {
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    feeCents: Number(row.fee_cents),
    currency: String(row.currency || "usd"),
    effectiveFrom: String(row.effective_from),
    effectiveUntil: row.effective_until ? String(row.effective_until) : null,
    agreementReference: String(row.agreement_reference || ""),
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    createdByAdminUserId: String(row.created_by_admin_user_id || ""),
    supersededAt: row.superseded_at ? String(row.superseded_at) : null,
    createdAt: String(row.created_at),
  };
}

function toReferralFeeRequest(row: any): VenueReferralFeeChangeRequest {
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    requestedFeeCents: Number(row.requested_fee_cents),
    currency: String(row.currency || "usd"),
    reason: String(row.reason || ""),
    status: row.status,
    requestedByUserId: String(row.requested_by_user_id),
    reviewedByAdminUserId: row.reviewed_by_admin_user_id ? String(row.reviewed_by_admin_user_id) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function validFeeCents(value: unknown) {
  const cents = Math.trunc(Number(value));
  if (!Number.isSafeInteger(cents) || cents < 100 || cents > 100_000) {
    throw new Error("Referral fee must be between $1.00 and $1,000.00 per verified customer redemption.");
  }
  return cents;
}

function validEffectiveDate(value: unknown) {
  const date = new Date(String(value || ""));
  const earliest = Date.now() - 5 * 60_000;
  const latest = Date.now() + 5 * 365 * 24 * 60 * 60_000;
  if (!Number.isFinite(date.getTime()) || date.getTime() < earliest || date.getTime() > latest) {
    throw new Error("Effective date must be between now and five years from now.");
  }
  return date.toISOString();
}

function requiredText(value: unknown, message: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min) throw new Error(message);
  if (text.length > max) throw new Error(`${message} Use ${max} characters or fewer.`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (text.length > max) throw new Error(`Notes must be ${max} characters or fewer.`);
  return text || null;
}

function requiredUuid(value: unknown, message: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(message);
  }
  return text;
}
