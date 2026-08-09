import { createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotificationRows } from "./notification-delivery";

type DancrClient = SupabaseClient;

const TOKEN_TTL_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DANCER_PHOTO_BUCKET = "dancer-photos";

export class VenueAffiliationUserError extends Error {}

export function venueAffiliationRequestIp(request: Request) {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export function hashVenueAffiliationRequestIp(requestIp: string) {
  const secret = process.env.DANCR_IP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Venue verification IP hashing is not configured.");
  return createHmac("sha256", secret).update(requestIp || "unknown").digest("hex");
}

export async function getDancerVenueVerificationState(
  client: DancrClient,
  userId: string,
) {
  const dancer = await requireVenueApprovalCandidate(client, userId);
  const [{ data: venues, error: venuesError }, { data: affiliations, error: affiliationsError }] = await Promise.all([
    (client as any)
      .from("venues")
      .select("id, slug, name, city, state")
      .eq("is_active", true)
      .not("owner_user_id", "is", null)
      .order("city", { ascending: true })
      .order("name", { ascending: true }),
    (client as any)
      .from("venue_dancer_affiliations")
      .select(AFFILIATION_COLUMNS)
      .eq("dancer_id", dancer.id)
      .order("updated_at", { ascending: false }),
  ]);
  if (venuesError) throw venuesError;
  if (affiliationsError) throw affiliationsError;

  return {
    dancer: {
      id: dancer.id,
      stageName: dancer.stage_name,
      city: dancer.city,
    },
    venues: (venues || []).map(mapVenue),
    affiliations: (affiliations || []).map((row: any) => mapAffiliation(client, row)),
  };
}

export async function issueDancerVenueVerification(
  client: DancrClient,
  input: {
    userId: string;
    venueId: string;
    requestIpHash: string;
  },
) {
  const dancer = await requireVenueApprovalCandidate(client, input.userId);
  const venueId = requiredUuid(input.venueId, "Choose a venue to verify.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { data, error } = await (client as any).rpc("issue_dancer_venue_verification_token", {
    p_dancer_id: dancer.id,
    p_user_id: input.userId,
    p_venue_id: venueId,
    p_token_digest: hashVenueAffiliationToken(token),
    p_request_ip_hash: input.requestIpHash,
    p_expires_at: expiresAt,
  });
  if (error) throw toVenueAffiliationError(error);

  const { data: venue, error: venueError } = await (client as any)
    .from("venues")
    .select("id, slug, name, city, state")
    .eq("id", venueId)
    .single();
  if (venueError) throw venueError;

  console.info("DANCER_VENUE_VERIFICATION_ISSUED", {
    tokenId: data?.id || null,
    dancerId: dancer.id,
    venueId,
    expiresAt,
  });
  return {
    token,
    expiresAt,
    venue: mapVenue(venue),
  };
}

export async function getVenueDancerVerificationState(
  client: DancrClient,
  managerUserId: string,
  rawToken?: string | null,
) {
  const venue = await requireManagedVenue(client, managerUserId);
  const { data: affiliations, error } = await (client as any)
    .from("venue_dancer_affiliations")
    .select(AFFILIATION_COLUMNS)
    .eq("venue_id", venue.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return {
    venue: mapVenue(venue),
    affiliations: (affiliations || []).map((row: any) => mapAffiliation(client, row)),
    verification: rawToken
      ? await previewDancerVenueVerification(client, managerUserId, rawToken, venue.id)
      : null,
  };
}

export async function approveDancerVenueVerification(
  client: DancrClient,
  input: { managerUserId: string; token: string },
) {
  const digest = hashVenueAffiliationToken(input.token);
  const { data, error } = await (client as any).rpc("approve_dancer_venue_affiliation", {
    p_token_digest: digest,
    p_manager_user_id: input.managerUserId,
  });
  if (error) throw toVenueAffiliationError(error);

  const notification = {
    recipient_id: String(data.dancerUserId),
    notification_type: "venue_affiliation_status" as const,
    title: `${String(data.venueName)} approved your affiliation`,
    body: data.profileActivated
      ? `Your affiliation is confirmed, your profile is now live, and your full dancer dashboard is unlocked.`
      : `Your venue affiliation is active. You can check in at ${String(data.venueName)} for Working Now and eligible Club Deal commissions.`,
    payload: {
      affiliationId: data.id,
      venueId: data.venueId,
      venueSlug: data.venueSlug,
      status: "active",
    },
  };
  await deliverNotificationRows(client, [notification]).catch((notificationError) => {
    console.warn("DANCER_VENUE_APPROVAL_NOTIFICATION_FAILED", {
      affiliationId: data.id,
      message: notificationError instanceof Error ? notificationError.message : String(notificationError),
    });
  });

  console.info("DANCER_VENUE_AFFILIATION_APPROVED", {
    affiliationId: data.id,
    dancerId: data.dancerId,
    venueId: data.venueId,
    managerUserId: input.managerUserId,
  });
  return data;
}

export async function revokeDancerVenueAffiliation(
  client: DancrClient,
  input: { actorUserId: string; affiliationId: string; reason?: string | null },
) {
  const affiliationId = requiredUuid(input.affiliationId, "Venue affiliation is required.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  const { data, error } = await (client as any).rpc("revoke_dancer_venue_affiliation", {
    p_affiliation_id: affiliationId,
    p_actor_user_id: input.actorUserId,
    p_reason: reason || null,
  });
  if (error) throw toVenueAffiliationError(error);

  if (String(data.dancerUserId) !== input.actorUserId) {
    await deliverNotificationRows(client, [{
      recipient_id: String(data.dancerUserId),
      notification_type: "venue_affiliation_status" as const,
      title: `${String(data.venueName)} verification ended`,
      body: data.profileDeactivated
        ? `Your last verified venue affiliation was removed, so your profile is private again. Confirm an affiliation with a verified venue manager to republish it.`
        : `Your verified venue affiliation with ${String(data.venueName)} was removed. Active check-ins and commission tracking there have stopped.`,
      payload: {
        affiliationId: data.id,
        venueId: data.venueId,
        venueSlug: data.venueSlug,
        status: "revoked",
      },
    }]).catch((notificationError) => {
      console.warn("DANCER_VENUE_REVOCATION_NOTIFICATION_FAILED", {
        affiliationId,
        message: notificationError instanceof Error ? notificationError.message : String(notificationError),
      });
    });
  }

  console.info("DANCER_VENUE_AFFILIATION_REVOKED", {
    affiliationId,
    dancerId: data.dancerId,
    venueId: data.venueId,
    actorUserId: input.actorUserId,
  });
  return data;
}

export async function assertDancerVenueAffiliationForShift(
  client: DancrClient,
  userId: string,
  shiftId: string,
) {
  const { data, error } = await (client as any)
    .from("shifts")
    .select("id, venue_id, dancer_profiles!inner(id, user_id)")
    .eq("id", requiredUuid(shiftId, "Shift is required."))
    .eq("dancer_profiles.user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new VenueAffiliationUserError("Shift not found.");

  const dancer = Array.isArray(data.dancer_profiles) ? data.dancer_profiles[0] : data.dancer_profiles;
  const { data: active, error: activeError } = await (client as any)
    .from("venue_dancer_affiliations")
    .select("id, status")
    .eq("venue_id", data.venue_id)
    .eq("dancer_id", dancer.id)
    .eq("status", "active")
    .maybeSingle();
  if (activeError) throw activeError;
  if (!active) {
    throw new VenueAffiliationUserError(
      "Ask this venue's verified manager to scan your personal verification QR before checking in.",
    );
  }
  return active;
}

export async function dancerHasActiveVenueAffiliation(
  client: DancrClient,
  dancerId: string,
  venueId: string,
) {
  const { data, error } = await (client as any)
    .from("venue_dancer_affiliations")
    .select("id")
    .eq("dancer_id", dancerId)
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function previewDancerVenueVerification(
  client: DancrClient,
  managerUserId: string,
  rawToken: string,
  managedVenueId: string,
) {
  const digest = hashVenueAffiliationToken(rawToken);
  const { data, error } = await (client as any)
    .from("venue_dancer_verification_tokens")
    .select(`
      id,
      venue_id,
      dancer_id,
      expires_at,
      used_at,
      revoked_at,
      venues!inner(id, slug, name, city, state, owner_user_id, is_active),
      dancer_profiles!inner(id, user_id, stage_name, slug, city, status, disabled_at, avatar_storage_path, photo_review_status)
    `)
    .eq("token_digest", digest)
    .maybeSingle();
  if (error) throw error;

  const venue = Array.isArray(data?.venues) ? data.venues[0] : data?.venues;
  const dancer = Array.isArray(data?.dancer_profiles) ? data.dancer_profiles[0] : data?.dancer_profiles;
  if (
    !data
    || data.used_at
    || data.revoked_at
    || new Date(data.expires_at).getTime() <= Date.now()
    || !venue
    || venue.id !== managedVenueId
    || venue.owner_user_id !== managerUserId
    || venue.is_active === false
    || !dancer
    || dancer.status === "rejected"
    || dancer.status === "disabled"
    || dancer.disabled_at
    || !String(dancer.stage_name || "").trim()
    || !String(dancer.city || "").trim()
    || !String(dancer.avatar_storage_path || "").trim()
    || dancer.photo_review_status !== "approved"
  ) {
    throw new VenueAffiliationUserError("This dancer verification link is invalid or expired.");
  }

  const existing = await activeAffiliation(client, String(data.venue_id), String(data.dancer_id));
  return {
    tokenExpiresAt: data.expires_at,
    alreadyVerified: Boolean(existing),
    dancer: {
      id: dancer.id,
      stageName: dancer.stage_name,
      slug: dancer.slug,
      city: dancer.city,
      avatarUrl: publicAvatarUrl(client, dancer.avatar_storage_path),
    },
    venue: mapVenue(venue),
  };
}

async function activeAffiliation(client: DancrClient, venueId: string, dancerId: string) {
  const { data, error } = await (client as any)
    .from("venue_dancer_affiliations")
    .select("id, status")
    .eq("venue_id", venueId)
    .eq("dancer_id", dancerId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function requireVenueApprovalCandidate(client: DancrClient, userId: string) {
  const { data, error } = await (client as any)
    .from("dancer_profiles")
    .select("id, user_id, stage_name, slug, city, status, disabled_at, avatar_storage_path, photo_review_status, venue_approved_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === "rejected" || data.status === "disabled" || data.disabled_at) {
    throw new VenueAffiliationUserError("An active dancer account is required for venue affiliation.");
  }
  if (!String(data.stage_name || "").trim() || !String(data.city || "").trim()) {
    throw new VenueAffiliationUserError("Save your stage name and city before venue affiliation.");
  }
  if (!String(data.avatar_storage_path || "").trim()) {
    throw new VenueAffiliationUserError("Upload a profile avatar before venue affiliation.");
  }
  if (data.photo_review_status !== "approved") {
    throw new VenueAffiliationUserError("Your avatar must pass automated moderation before venue affiliation.");
  }
  return data;
}

async function requireManagedVenue(client: DancrClient, managerUserId: string) {
  const { data, error } = await (client as any)
    .from("venues")
    .select("id, slug, name, city, state, owner_user_id, is_active")
    .eq("owner_user_id", managerUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false) {
    throw new VenueAffiliationUserError("A verified active venue manager account is required.");
  }
  return data;
}

const AFFILIATION_COLUMNS = `
  id,
  venue_id,
  dancer_id,
  status,
  approved_at,
  revoked_at,
  revoke_reason,
  updated_at,
  venues!inner(id, slug, name, city, state),
  dancer_profiles!inner(id, user_id, stage_name, slug, city, avatar_storage_path)
`;

function mapAffiliation(client: DancrClient, row: any) {
  const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
  const dancer = Array.isArray(row.dancer_profiles) ? row.dancer_profiles[0] : row.dancer_profiles;
  return {
    id: row.id,
    venueId: row.venue_id,
    dancerId: row.dancer_id,
    status: row.status,
    approvedAt: row.approved_at,
    revokedAt: row.revoked_at || null,
    revokeReason: row.revoke_reason || null,
    updatedAt: row.updated_at,
    venue: venue ? mapVenue(venue) : null,
    dancer: dancer
      ? {
          id: dancer.id,
          stageName: dancer.stage_name,
          slug: dancer.slug,
          city: dancer.city,
          avatarUrl: publicAvatarUrl(client, dancer.avatar_storage_path),
        }
      : null,
  };
}

function mapVenue(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    state: row.state || null,
  };
}

function publicAvatarUrl(client: DancrClient, storagePath: unknown) {
  return typeof storagePath === "string" && storagePath
    ? client.storage.from(DANCER_PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl
    : null;
}

function hashVenueAffiliationToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    throw new VenueAffiliationUserError("This dancer verification link is invalid or expired.");
  }
  const secret = process.env.DANCER_VENUE_VERIFICATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Dancer venue verification hashing is not configured.");
  return createHmac("sha256", secret).update(token).digest("hex");
}

function requiredUuid(value: unknown, message: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new VenueAffiliationUserError(message);
  }
  return text;
}

function toVenueAffiliationError(error: { message?: string }) {
  const message = String(error?.message || "");
  if (/automated media moderation|has not completed profile setup/i.test(message)) {
    return new VenueAffiliationUserError("Finish profile setup and wait for every uploaded picture and video to pass moderation.");
  }
  if (/profile setup|stage name|city/i.test(message)) {
    return new VenueAffiliationUserError("Finish your profile details before venue affiliation.");
  }
  if (/avatar|photo moderation|moderation-safe/i.test(message)) {
    return new VenueAffiliationUserError("Your avatar must pass automated moderation before venue affiliation.");
  }
  if (/verified manager|manager can approve|does not have a verified manager/i.test(message)) {
    return new VenueAffiliationUserError(
      /approve/i.test(message)
        ? "Only this venue's verified manager can approve the dancer."
        : "This venue does not have a verified manager yet.",
    );
  }
  if (/too many verification/i.test(message)) {
    return new VenueAffiliationUserError("Too many verification links were created. Try again later.");
  }
  if (/invalid|expired|verification link/i.test(message)) {
    return new VenueAffiliationUserError("This dancer verification link is invalid or expired.");
  }
  if (/affiliation not found/i.test(message)) {
    return new VenueAffiliationUserError("Venue affiliation not found.");
  }
  if (/only the dancer|remove this affiliation/i.test(message)) {
    return new VenueAffiliationUserError("You are not allowed to remove this venue affiliation.");
  }
  return error;
}
