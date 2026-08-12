import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireVenueAccess } from "./venue-access";

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
  lastScannedAt: string | null;
  scanCount: number;
  createdAt: string;
};

export type AdminNfcTagSummary = NfcTagSummary & {
  venue: { id: string; name: string; slug: string; city: string; state: string | null };
};

export type ResolvedNfcTag = NfcTagSummary & {
  venue: { id: string; name: string; slug: string; city: string; state: string };
};

export type DancerNfcDashboardState = {
  profileAuthorization: {
    profileExists: boolean;
    authorized: boolean;
    authorizedAt: string | null;
    profileStatus: string | null;
    mediaReviewStatus: string | null;
    isPublic: boolean;
  };
  affiliations: Array<{
    id: string;
    status: string;
    approvedAt: string | null;
    revokedAt: string | null;
    venue: { id: string; name: string; slug: string; city: string; state: string | null } | null;
  }>;
  enrollment: {
    id: string;
    status: string;
    tappedAt: string;
    expiresAt: string;
    completedAt: string | null;
    venue: { id: string; name: string; slug: string; city: string; state: string | null } | null;
  } | null;
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
  const access = await requireVenueAccess(client, ownerUserId, "view_nfc");
  const { data, error } = await (client as any)
    .from("nfc_tags")
    .select("id, venue_id, tag_type, label, status, last_tapped_at, tap_count, last_scanned_at, scan_count, created_at")
    .eq("venue_id", access.venueId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(toTagSummary);
}

export async function listAdminNfcTags(client: DancrClient): Promise<AdminNfcTagSummary[]> {
  const { data, error } = await (client as any)
    .from("nfc_tags")
    .select("id, venue_id, tag_type, label, status, last_tapped_at, tap_count, last_scanned_at, scan_count, created_at, venues(id, name, slug, city, state)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map((row: any) => {
    const venue = firstJoined(row.venues);
    if (!venue) throw new Error("An NFC tag is missing its venue assignment.");
    return {
      ...toTagSummary(row),
      venue: {
        id: String(venue.id),
        name: String(venue.name),
        slug: String(venue.slug),
        city: String(venue.city),
        state: venue.state ? String(venue.state) : null,
      },
    };
  });
}

export async function createAdminVenueNfcTag(
  client: DancrClient,
  input: { adminUserId: string; venueId: string; type: NfcTagType; label: string },
) {
  if (!UUID_PATTERN.test(input.venueId)) throw new Error("A valid venue is required.");
  const venue = await requireProvisionableVenue(client, input.venueId);
  const type = normalizeTagType(input.type);
  const label = normalizeTagLabel(input.label);
  await requireActiveAdmin(client, input.adminUserId);
  const token = crypto.randomBytes(32).toString("base64url");
  const tagId = crypto.randomUUID();
  const { data, error } = await (client as any).rpc("provision_admin_venue_nfc_tag", {
    p_tag_id: tagId,
    p_venue_id: venue.id,
    p_admin_user_id: input.adminUserId,
    p_tag_type: type,
    p_label: label,
    p_token_digest: hashNfcToken(token),
  });
  if (error) throw friendlyTagError(error);
  return { tag: toTagSummary(data), token, venue };
}

export async function rotateAdminVenueNfcTag(
  client: DancrClient,
  input: { adminUserId: string; tagId: string },
) {
  if (!UUID_PATTERN.test(input.tagId)) throw new Error("A valid NFC sticker is required.");
  await requireActiveAdmin(client, input.adminUserId);
  const token = crypto.randomBytes(32).toString("base64url");
  const replacementId = crypto.randomUUID();
  const { data, error } = await (client as any).rpc("rotate_admin_venue_nfc_tag", {
    p_tag_id: input.tagId,
    p_admin_user_id: input.adminUserId,
    p_replacement_id: replacementId,
    p_token_digest: hashNfcToken(token),
  });
  if (error) throw friendlyTagError(error);
  return { tag: toTagSummary(data), token };
}

export async function setAdminVenueNfcTagStatus(
  client: DancrClient,
  input: { adminUserId: string; tagId: string; status: "active" | "disabled" },
) {
  if (!UUID_PATTERN.test(input.tagId)) throw new Error("A valid NFC sticker is required.");
  await requireActiveAdmin(client, input.adminUserId);
  const { data, error } = await (client as any).rpc("set_admin_venue_nfc_tag_status", {
    p_tag_id: input.tagId,
    p_admin_user_id: input.adminUserId,
    p_status: input.status,
  });
  if (error) throw friendlyTagError(error);
  if (!data) throw new Error("NFC sticker not found.");
  return toTagSummary(data);
}

export async function resolveNfcTag(client: DancrClient, token: string): Promise<ResolvedNfcTag | null> {
  if (!isNfcToken(token)) return null;
  const { data, error } = await (client as any)
    .from("nfc_tags")
    .select("id, venue_id, tag_type, label, status, last_tapped_at, tap_count, last_scanned_at, scan_count, created_at, venues(id, name, slug, city, state, is_active)")
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

export async function recordNfcTagScan(client: DancrClient, tagId: string) {
  if (!UUID_PATTERN.test(tagId)) throw new Error("Invalid NFC sticker.");
  const { data, error } = await (client as any).rpc("record_nfc_tag_scan", {
    p_tag_id: tagId,
  });
  if (error) throw error;
  return data ? toTagSummary(data) : null;
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
  await authorizeDancerProfileFromNfc(client, input.dancerUserId);
  if (data?.enrollmentStatus !== "completed") return data;

  const { data: presence, error: presenceError } = await (client as any).rpc("activate_dancer_shift_from_nfc", {
    p_tag_id: input.tagId,
    p_dancer_user_id: input.dancerUserId,
    p_session_id: input.sessionId,
    p_audit: {
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
    },
  });
  if (presenceError) throw presenceError;
  return { ...data, ...presence };
}

export async function finalizePendingDancerNfcEnrollment(
  client: DancrClient,
  input: { dancerUserId: string; sessionId?: string; request?: Request },
) {
  await authorizeDancerProfileFromNfc(client, input.dancerUserId);
  const sessionId = input.sessionId && UUID_PATTERN.test(input.sessionId) ? input.sessionId : crypto.randomUUID();
  const audit = input.request
    ? requestAudit(input.request)
    : { ipAddress: null, userAgent: null, deviceFingerprint: null };
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

export async function getDancerNfcDashboardState(
  client: DancrClient,
  dancerUserId: string,
): Promise<DancerNfcDashboardState> {
  const { data: profile, error: profileError } = await (client as any)
    .from("dancer_profiles")
    .select("id, status, photo_review_status, is_public, venue_approved_at")
    .eq("user_id", dancerUserId)
    .maybeSingle();
  if (profileError) throw profileError;

  const affiliationQuery = profile
    ? (client as any)
        .from("venue_dancer_affiliations")
        .select("id, status, approved_at, revoked_at, venues(id, name, slug, city, state)")
        .eq("dancer_id", profile.id)
        .order("updated_at", { ascending: false })
    : Promise.resolve({ data: [], error: null });
  const enrollmentQuery = (client as any)
    .from("dancer_nfc_enrollments")
    .select("id, status, tapped_at, expires_at, completed_at, venues(id, name, slug, city, state)")
    .eq("dancer_user_id", dancerUserId)
    .order("tapped_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const [{ data: affiliations, error: affiliationsError }, { data: enrollment, error: enrollmentError }] = await Promise.all([
    affiliationQuery,
    enrollmentQuery,
  ]);
  if (affiliationsError) throw affiliationsError;
  if (enrollmentError) throw enrollmentError;

  return {
    profileAuthorization: {
      profileExists: Boolean(profile),
      authorized: Boolean(profile?.venue_approved_at),
      authorizedAt: profile?.venue_approved_at ? String(profile.venue_approved_at) : null,
      profileStatus: profile?.status ? String(profile.status) : null,
      mediaReviewStatus: profile?.photo_review_status ? String(profile.photo_review_status) : null,
      isPublic: profile?.is_public === true,
    },
    affiliations: (affiliations || []).map((row: any) => ({
      id: String(row.id),
      status: String(row.status),
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null,
      venue: mapDashboardVenue(firstJoined(row.venues)),
    })),
    enrollment: enrollment
      ? {
          id: String(enrollment.id),
          status: String(enrollment.status),
          tappedAt: String(enrollment.tapped_at),
          expiresAt: String(enrollment.expires_at),
          completedAt: enrollment.completed_at ? String(enrollment.completed_at) : null,
          venue: mapDashboardVenue(firstJoined(enrollment.venues)),
        }
      : null,
  };
}

async function authorizeDancerProfileFromNfc(client: DancrClient, dancerUserId: string) {
  const { error } = await (client as any).rpc("authorize_dancer_profile_from_nfc", {
    p_dancer_user_id: dancerUserId,
  });
  if (error) throw error;
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

async function requireActiveAdmin(client: DancrClient, adminUserId: string) {
  if (!UUID_PATTERN.test(adminUserId)) throw new Error("Admin access required.");
  const { data, error } = await (client as any)
    .from("app_users")
    .select("id")
    .eq("id", adminUserId)
    .eq("role", "admin")
    .eq("account_state", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Admin access required.");
}

async function requireProvisionableVenue(client: DancrClient, venueId: string) {
  const { data, error } = await (client as any)
    .from("venues")
    .select("id, name, slug, is_active")
    .eq("id", venueId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("An active venue is required.");
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
    lastScannedAt: row.last_scanned_at ? String(row.last_scanned_at) : null,
    scanCount: Number(row.scan_count || 0),
    createdAt: String(row.created_at),
  };
}

function firstJoined(value: unknown): any {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function mapDashboardVenue(row: any) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    city: String(row.city),
    state: row.state ? String(row.state) : null,
  };
}

function friendlyTagError(error: any) {
  if (String(error?.code || "") === "23505") {
    return new Error("An active NFC tag already uses that label. Rename it or rotate the existing tag.");
  }
  return error;
}
