import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export const NFC_TAG_TYPES = ["dressing_room", "cashier"] as const;
export type NfcTagType = (typeof NFC_TAG_TYPES)[number];
export type NfcTagStatus = "active" | "disabled" | "revoked";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NfcTagSummary = {
  id: string;
  venueId: string;
  type: NfcTagType;
  label: string;
  status: NfcTagStatus;
  lastTappedAt: string | null;
  tapCount: number;
  createdAt: string;
};

export type ResolvedNfcTag = NfcTagSummary & {
  venue: { id: string; name: string; slug: string; city: string; state: string };
};

export function hashNfcToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function isNfcToken(token: string) {
  return /^[A-Za-z0-9_-]{40,120}$/.test(token);
}

export function requestAudit(request: Request) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || null,
    userAgent: request.headers.get("user-agent") || null,
    deviceFingerprint: request.headers.get("x-device-fingerprint") || null,
  };
}

export async function listVenueNfcTags(client: DancrClient, ownerUserId: string): Promise<NfcTagSummary[]> {
  const venue = await requireOwnedVenue(client, ownerUserId);
  const { data, error } = await (client as any)
    .from("nfc_tags")
    .select("id, venue_id, tag_type, label, status, last_tapped_at, tap_count, created_at")
    .eq("venue_id", venue.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(toTagSummary);
}

export async function createVenueNfcTag(
  client: DancrClient,
  input: { ownerUserId: string; type: NfcTagType; label: string },
) {
  const venue = await requireOwnedVenue(client, input.ownerUserId);
  const type = normalizeTagType(input.type);
  const label = normalizeTagLabel(input.label);
  const { count, error: countError } = await (client as any)
    .from("nfc_tags")
    .select("*", { count: "exact", head: true })
    .eq("venue_id", venue.id)
    .eq("status", "active");
  if (countError) throw countError;
  if ((count || 0) >= 25) throw new Error("This venue already has the maximum of 25 active NFC tags.");

  const token = crypto.randomBytes(32).toString("base64url");
  const { data, error } = await (client as any)
    .from("nfc_tags")
    .insert({
      venue_id: venue.id,
      tag_type: type,
      label,
      token_digest: hashNfcToken(token),
      status: "active",
      created_by_user_id: input.ownerUserId,
    })
    .select("id, venue_id, tag_type, label, status, last_tapped_at, tap_count, created_at")
    .single();
  if (error) throw friendlyTagError(error);

  return { tag: toTagSummary(data), token, venue };
}

export async function rotateVenueNfcTag(
  client: DancrClient,
  input: { ownerUserId: string; tagId: string },
) {
  if (!UUID_PATTERN.test(input.tagId)) throw new Error("A valid NFC tag is required.");
  const venue = await requireOwnedVenue(client, input.ownerUserId);
  const token = crypto.randomBytes(32).toString("base64url");
  const replacementId = crypto.randomUUID();
  const { data, error } = await (client as any).rpc("rotate_venue_nfc_tag", {
    p_tag_id: input.tagId,
    p_owner_user_id: input.ownerUserId,
    p_replacement_id: replacementId,
    p_token_digest: hashNfcToken(token),
  });
  if (error) throw friendlyTagError(error);
  return { tag: toTagSummary(data), token, venue };
}

export async function setVenueNfcTagStatus(
  client: DancrClient,
  input: { ownerUserId: string; tagId: string; status: "active" | "disabled" },
) {
  if (!UUID_PATTERN.test(input.tagId)) throw new Error("A valid NFC tag is required.");
  const venue = await requireOwnedVenue(client, input.ownerUserId);
  const now = new Date().toISOString();
  const { data, error } = await (client as any)
    .from("nfc_tags")
    .update({
      status: input.status,
      disabled_at: input.status === "disabled" ? now : null,
      updated_at: now,
    })
    .eq("id", input.tagId)
    .eq("venue_id", venue.id)
    .neq("status", "revoked")
    .select("id, venue_id, tag_type, label, status, last_tapped_at, tap_count, created_at")
    .maybeSingle();
  if (error) throw friendlyTagError(error);
  if (!data) throw new Error("NFC tag not found.");
  return toTagSummary(data);
}

export async function resolveNfcTag(client: DancrClient, token: string): Promise<ResolvedNfcTag | null> {
  if (!isNfcToken(token)) return null;
  const { data, error } = await (client as any)
    .from("nfc_tags")
    .select("id, venue_id, tag_type, label, status, last_tapped_at, tap_count, created_at, venues(id, name, slug, city, state, is_active)")
    .eq("token_digest", hashNfcToken(token))
    .maybeSingle();
  if (error) throw error;
  const venue = firstJoined(data?.venues);
  if (!data || data.status !== "active" || !venue || venue.is_active !== true) return null;
  return {
    ...toTagSummary(data),
    venue: {
      id: String(venue.id),
      name: String(venue.name),
      slug: String(venue.slug),
      city: String(venue.city),
      state: String(venue.state),
    },
  };
}

export async function registerDancerFromNfc(
  client: DancrClient,
  input: { tagId: string; dancerUserId: string; sessionId: string; request: Request },
) {
  if (!UUID_PATTERN.test(input.tagId) || !UUID_PATTERN.test(input.sessionId)) {
    throw new Error("Invalid NFC tap session.");
  }
  const audit = requestAudit(input.request);
  const { data, error } = await (client as any).rpc("register_dancer_nfc_enrollment", {
    p_tag_id: input.tagId,
    p_dancer_user_id: input.dancerUserId,
    p_session_id: input.sessionId,
    p_audit: {
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
    },
  });
  if (error) throw error;
  return data;
}

export async function finalizePendingDancerNfcEnrollment(
  client: DancrClient,
  input: { dancerUserId: string; sessionId?: string; request?: Request },
) {
  const sessionId = input.sessionId && UUID_PATTERN.test(input.sessionId) ? input.sessionId : crypto.randomUUID();
  const audit = input.request ? requestAudit(input.request) : { ipAddress: null, userAgent: null, deviceFingerprint: null };
  const { data, error } = await (client as any).rpc("finalize_pending_dancer_nfc_enrollment", {
    p_dancer_user_id: input.dancerUserId,
    p_session_id: sessionId,
    p_audit: {
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
    },
  });
  if (error) throw error;
  return data;
}

export async function confirmRedemptionFromNfc(
  client: DancrClient,
  input: { tagId: string; redemptionToken: string; sessionId: string; request: Request },
) {
  if (!UUID_PATTERN.test(input.tagId) || !UUID_PATTERN.test(input.sessionId)) {
    throw new Error("Invalid NFC tap session.");
  }
  const audit = requestAudit(input.request);
  const { data, error } = await (client as any).rpc("confirm_deal_redemption_from_nfc", {
    p_token: input.redemptionToken,
    p_tag_id: input.tagId,
    p_session_id: input.sessionId,
    p_audit: {
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
    },
  });
  if (error) throw error;
  return data;
}

function normalizeTagType(value: unknown): NfcTagType {
  if (value === "dressing_room" || value === "cashier") return value;
  throw new Error("Choose a dressing-room or cashier NFC tag.");
}

function normalizeTagLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (label.length < 2 || label.length > 80) throw new Error("NFC tag label must be 2 to 80 characters.");
  return label;
}

async function requireOwnedVenue(client: DancrClient, ownerUserId: string) {
  const { data, error } = await (client as any)
    .from("venues")
    .select("id, name, slug")
    .eq("owner_user_id", ownerUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("An active venue profile is required.");
  return { id: String(data.id), name: String(data.name), slug: String(data.slug) };
}

function toTagSummary(row: any): NfcTagSummary {
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    type: row.tag_type as NfcTagType,
    label: String(row.label),
    status: row.status as NfcTagStatus,
    lastTappedAt: row.last_tapped_at ? String(row.last_tapped_at) : null,
    tapCount: Number(row.tap_count || 0),
    createdAt: String(row.created_at),
  };
}

function firstJoined(value: unknown): any {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function friendlyTagError(error: any) {
  if (String(error?.code || "") === "23505") {
    return new Error("An active NFC tag already uses that label. Rename it or rotate the existing tag.");
  }
  return error;
}
