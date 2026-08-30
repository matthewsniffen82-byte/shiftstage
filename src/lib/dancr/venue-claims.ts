import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotificationRows } from "./notification-delivery";

type DancrClient = SupabaseClient;

const PROOF_BUCKET = "venue-ownership-proofs";
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const MAX_CLAIMS_PER_IP_PER_DAY = 5;
const PROOF_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class VenueClaimUserError extends Error {}

export type VenueOwnershipClaimInput = {
  venueId: string;
  claimCodeId: string;
  userId: string;
  email: string;
  claimantName: string;
  claimantTitle: string;
  claimantPhone: string;
  proofFile: File;
  requestIpHash: string;
};

export async function resolveVenueClaimCode(
  client: DancrClient,
  venueIdValue: string,
  rawCode: string,
) {
  const venueId = requiredText(venueIdValue, "Venue is required.", 1, 80);
  const codeDigest = hashVenueClaimCode(rawCode);
  const { data, error } = await (client as any)
    .from("venue_claim_codes")
    .select("id, venue_id, expires_at, used_at, revoked_at")
    .eq("venue_id", venueId)
    .eq("code_digest", codeDigest)
    .maybeSingle();
  if (error) throw error;

  if (
    !data
    || data.used_at
    || data.revoked_at
    || new Date(data.expires_at).getTime() <= Date.now()
  ) {
    throw new VenueClaimUserError("This venue claim code is invalid or no longer active.");
  }
  return data.id as string;
}

export async function resolveVenueSignupCode(client: DancrClient, rawCode: string) {
  const codeDigest = hashVenueClaimCode(rawCode);
  const { data, error } = await (client as any)
    .from("venue_claim_codes")
    .select("id, venue_id, expires_at, used_at, revoked_at, venues!inner(id, slug, name, city, state, owner_user_id, is_active)")
    .eq("code_digest", codeDigest)
    .maybeSingle();
  if (error) throw error;

  const venue = Array.isArray(data?.venues) ? data.venues[0] : data?.venues;
  if (
    !data
    || data.used_at
    || data.revoked_at
    || new Date(data.expires_at).getTime() <= Date.now()
    || !venue
    || venue.owner_user_id
  ) {
    throw new VenueClaimUserError("This venue access code is invalid or no longer active.");
  }

  const { data: request, error: requestError } = await (client as any)
    .from("venue_signup_requests")
    .select("id")
    .eq("status", "approved")
    .eq("matched_venue_id", venue.id)
    .eq("access_code_id", data.id)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request) {
    throw new VenueClaimUserError("This venue access code is invalid or no longer active.");
  }

  return {
    codeId: data.id as string,
    venue: {
      id: venue.id as string,
      slug: venue.slug as string,
      name: venue.name as string,
      city: venue.city as string,
      state: (venue.state as string | null) || null,
    },
  };
}

export async function redeemVenueSignupCode(
  client: DancrClient,
  input: { codeId: string; userId: string },
) {
  const { data, error } = await (client as any).rpc("redeem_venue_signup_code", {
    p_code_id: requiredText(input.codeId, "Venue access code is required.", 1, 80),
    p_user_id: requiredText(input.userId, "Venue account is required.", 1, 80),
  });
  if (error) {
    const message = error.message || "";
    if (/access code|claim code|already has a manager|already manages/i.test(message)) {
      throw new VenueClaimUserError(
        /already has a manager/i.test(message)
          ? "This venue is already connected to a manager account."
          : /already manages/i.test(message)
            ? "This account already manages another venue."
            : "This venue access code is invalid or no longer active.",
      );
    }
    throw error;
  }
  console.info("VENUE_SIGNUP_CODE_REDEEMED", {
    codeId: input.codeId,
    userId: input.userId,
    venueId: data?.id || null,
  });
  return data;
}

export async function getAdminVenueClaimCodes(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("venue_claim_codes")
    .select(CLAIM_CODE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map(mapClaimCode);
}

export async function issueVenueClaimCode(
  client: DancrClient,
  input: { venueId: string; adminId: string; expiresInDays?: number },
) {
  const venueId = requiredText(input.venueId, "Venue is required.", 1, 80);
  const expiresInDays = Number.isInteger(input.expiresInDays) ? Number(input.expiresInDays) : 7;
  if (expiresInDays < 1 || expiresInDays > 30) {
    throw new VenueClaimUserError("Venue access codes must expire in 1 to 30 days.");
  }

  const { code, digest } = createVenueSignupCredential();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await (client as any).rpc("issue_venue_claim_code", {
    p_venue_id: venueId,
    p_admin_id: input.adminId,
    p_code_digest: digest,
    p_expires_at: expiresAt,
  });
  if (error) {
    if (/already has a verified manager/i.test(error.message || "")) {
      throw new VenueClaimUserError("This venue already has a verified manager.");
    }
    if (/active venue not found/i.test(error.message || "")) {
      throw new VenueClaimUserError("This venue is not available for an access code.");
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  console.info("VENUE_CLAIM_CODE_ISSUED", {
    codeId: row.id,
    venueId,
    expiresAt,
    adminId: input.adminId,
  });
  return { code, claimCode: mapClaimCode(row) };
}

export async function revokeVenueClaimCode(
  client: DancrClient,
  input: { codeId: string; adminId: string },
) {
  const codeId = requiredText(input.codeId, "Venue access code is required.", 1, 80);
  const { data, error } = await (client as any).rpc("revoke_venue_claim_code", {
    p_code_id: codeId,
    p_admin_id: input.adminId,
  });
  if (error) {
    if (/used venue claim code cannot be revoked/i.test(error.message || "")) {
      throw new VenueClaimUserError("A used venue access code cannot be revoked.");
    }
    if (/venue claim code not found/i.test(error.message || "")) {
      throw new VenueClaimUserError("Venue access code not found.");
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  console.info("VENUE_CLAIM_CODE_REVOKED", {
    codeId,
    venueId: row.venue_id,
    adminId: input.adminId,
  });
  return mapClaimCode(row);
}

export async function createVenueOwnershipClaim(
  client: DancrClient,
  input: VenueOwnershipClaimInput,
) {
  const venueId = requiredText(input.venueId, "Venue is required.", 1, 80);
  const claimCodeId = requiredText(input.claimCodeId, "A valid venue claim code is required.", 1, 80);
  const email = normalizedEmail(input.email);
  const claimantName = requiredText(input.claimantName, "Your full name is required.", 2, 160);
  const claimantTitle = requiredText(input.claimantTitle, "Your position at the venue is required.", 2, 120);
  const claimantPhone = requiredText(input.claimantPhone, "A business phone number is required.", 7, 50);
  const proof = await validateVenueClaimProof(input.proofFile);
  const db = client as any;

  const [{ data: venue, error: venueError }, { data: ownedVenue, error: ownedVenueError }] = await Promise.all([
    db
      .from("venues")
      .select("id, slug, name, city, state, owner_user_id, is_active")
      .eq("id", venueId)
      .maybeSingle(),
    db
      .from("venues")
      .select("id, name")
      .eq("owner_user_id", input.userId)
      .maybeSingle(),
  ]);
  if (venueError) throw venueError;
  if (ownedVenueError) throw ownedVenueError;
  if (!venue || venue.is_active === false) throw new VenueClaimUserError("This venue card is not available to claim.");
  if (venue.owner_user_id) throw new VenueClaimUserError("This venue is already managed by a verified account.");
  if (ownedVenue) throw new VenueClaimUserError(`This account already manages ${ownedVenue.name}.`);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: recentIpClaims, error: rateError }, { data: existingClaim, error: existingError }] = await Promise.all([
    db
      .from("venue_ownership_claims")
      .select("id", { count: "exact", head: true })
      .eq("request_ip_hash", input.requestIpHash)
      .gte("submitted_at", oneDayAgo),
    db
      .from("venue_ownership_claims")
      .select("id, status")
      .eq("venue_id", venueId)
      .eq("claimant_user_id", input.userId)
      .eq("status", "pending")
      .maybeSingle(),
  ]);
  if (rateError) throw rateError;
  if (existingError) throw existingError;
  if ((recentIpClaims || 0) >= MAX_CLAIMS_PER_IP_PER_DAY) {
    throw new VenueClaimUserError("Too many venue claims were submitted. Try again tomorrow.");
  }
  if (existingClaim) throw new VenueClaimUserError("Your claim for this venue is already under review.");

  const storagePath = `${venueId}/${input.userId}/${randomUUID()}.${proof.extension}`;
  const { error: uploadError } = await client.storage
    .from(PROOF_BUCKET)
    .upload(storagePath, proof.buffer, {
      contentType: proof.mimeType,
      cacheControl: "private, max-age=0",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  try {
    const { data, error } = await db
      .from("venue_ownership_claims")
      .insert({
        venue_id: venueId,
        claim_code_id: claimCodeId,
        claimant_user_id: input.userId,
        claimant_email: email,
        claimant_name: claimantName,
        claimant_title: claimantTitle,
        claimant_phone: claimantPhone,
        proof_storage_path: storagePath,
        proof_file_name: safeOriginalFileName(input.proofFile.name, proof.extension),
        proof_mime_type: proof.mimeType,
        request_ip_hash: input.requestIpHash,
        status: "pending",
      })
      .select(CLAIM_COLUMNS)
      .single();
    if (error) {
      if (/venue claim code|valid venue claim code/i.test(error.message || "")) {
        throw new VenueClaimUserError("This venue claim code is invalid or no longer active.");
      }
      throw error;
    }
    console.info("VENUE_OWNERSHIP_CLAIM_SUBMITTED", {
      claimId: data.id,
      venueId,
      claimantUserId: input.userId,
    });
    return mapClaim(data);
  } catch (error) {
    await client.storage.from(PROOF_BUCKET).remove([storagePath]).catch(() => null);
    throw error;
  }
}

export async function getLatestVenueOwnershipClaim(client: DancrClient, userId: string) {
  const { data, error } = await (client as any)
    .from("venue_ownership_claims")
    .select(CLAIM_COLUMNS)
    .eq("claimant_user_id", userId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapClaim(data) : null;
}

export async function hasVenueOwnershipClaim(client: DancrClient, userId: string) {
  const { count, error } = await (client as any)
    .from("venue_ownership_claims")
    .select("id", { count: "exact", head: true })
    .eq("claimant_user_id", userId);
  if (error) throw error;
  return (count || 0) > 0;
}

export async function getAdminVenueOwnershipClaims(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("venue_ownership_claims")
    .select(CLAIM_COLUMNS)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw error;

  return Promise.all((data || []).map(async (row: any) => {
    const claim = mapClaim(row);
    let proofUrl: string | null = null;
    if (row.proof_storage_path) {
      const { data: signed, error: signedError } = await client.storage
        .from(PROOF_BUCKET)
        .createSignedUrl(row.proof_storage_path, 15 * 60);
      if (signedError) {
        console.warn("VENUE_CLAIM_PROOF_SIGNING_FAILED", { claimId: row.id, message: signedError.message });
      } else {
        proofUrl = signed.signedUrl;
      }
    }

    const { data: authUser, error: authError } = await client.auth.admin.getUserById(row.claimant_user_id);
    if (authError) {
      console.warn("VENUE_CLAIM_EMAIL_STATUS_FAILED", { claimId: row.id, message: authError.message });
    }
    return {
      ...claim,
      proofUrl,
      emailConfirmed: Boolean(authUser?.user?.email_confirmed_at),
    };
  }));
}

export async function reviewVenueOwnershipClaim(
  client: DancrClient,
  input: { claimId: string; adminId: string; status: "approved" | "rejected"; notes?: string | null },
) {
  const claimId = requiredText(input.claimId, "Venue ownership claim is required.", 1, 80);
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "";
  if (input.status === "rejected" && !notes) {
    throw new VenueClaimUserError("Add a reason before rejecting this venue claim.");
  }

  const { data: pending, error: pendingError } = await (client as any)
    .from("venue_ownership_claims")
    .select(CLAIM_COLUMNS)
    .eq("id", claimId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingError) throw pendingError;
  if (!pending) throw new VenueClaimUserError("This venue ownership claim was already reviewed.");

  if (input.status === "approved") {
    const { data: authUser, error: authError } = await client.auth.admin.getUserById(pending.claimant_user_id);
    if (authError) throw authError;
    if (!authUser.user?.email_confirmed_at) {
      throw new VenueClaimUserError("The claimant must confirm their email before this claim can be approved.");
    }
  }

  const { data, error } = await (client as any).rpc("review_venue_ownership_claim", {
    p_claim_id: claimId,
    p_admin_id: input.adminId,
    p_status: input.status,
    p_notes: notes || null,
  });
  if (error) throw error;
  const reviewed = mapClaim({ ...data, venues: pending.venues });

  const venueName = reviewed.venue?.name || "your venue";
  const notification = {
    recipient_id: reviewed.claimantUserId,
    notification_type: "venue_claim_status" as const,
    title: input.status === "approved" ? "Venue claim approved" : "Venue claim needs attention",
    body: input.status === "approved"
      ? `Your account can now manage ${venueName} from the venue dashboard.`
      : `Your claim for ${venueName} was not approved. Review the decision and submit a new claim if needed.`,
    payload: {
      claimId: reviewed.id,
      venueId: reviewed.venueId,
      venueSlug: reviewed.venue?.slug || null,
      status: input.status,
      notes: notes || null,
    },
  };
  const notificationDelivery = await deliverNotificationRows(client, [notification]).catch((deliveryError) => {
    console.warn("VENUE_CLAIM_NOTIFICATION_DELIVERY_FAILED", {
      claimId,
      message: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
    });
    return { push: 0, email: 0 };
  });

  if (pending.proof_storage_path) {
    const { error: removeError } = await client.storage.from(PROOF_BUCKET).remove([pending.proof_storage_path]);
    if (removeError) {
      console.warn("VENUE_CLAIM_PROOF_CLEANUP_FAILED", { claimId, message: removeError.message });
    } else {
      await (client as any)
        .from("venue_ownership_claims")
        .update({ proof_storage_path: null, proof_cleared_at: new Date().toISOString() })
        .eq("id", claimId);
    }
  }

  console.info("VENUE_OWNERSHIP_CLAIM_REVIEWED", {
    claimId,
    venueId: reviewed.venueId,
    status: input.status,
    adminId: input.adminId,
  });
  return { ...reviewed, notificationDelivery };
}

export function hashVenueClaimRequestIp(requestIp: string) {
  const secret =
    process.env.DANCR_IP_HASH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Venue claim request security is not configured.");
  return createHmac("sha256", secret).update(requestIp || "unknown").digest("hex");
}

export function createVenueSignupCredential() {
  const code = createVenueClaimCodeValue();
  return { code, digest: hashVenueClaimCode(code) };
}

export async function validateVenueClaimProof(file: File) {
  if (!(file instanceof Blob) || file.size < 100) {
    throw new VenueClaimUserError("Add a readable business document or venue photo as proof.");
  }
  if (file.size > MAX_PROOF_BYTES) {
    throw new VenueClaimUserError("Venue proof must be 10 MB or smaller.");
  }

  const mimeType = file.type.toLowerCase();
  if (!PROOF_MIME_TYPES.has(mimeType)) {
    throw new VenueClaimUserError("Venue proof must be a PDF, JPEG, PNG, or WebP file.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesFileSignature(buffer, mimeType)) {
    throw new VenueClaimUserError("The venue proof file does not match its file type.");
  }
  return { buffer, mimeType, extension: extensionForMimeType(mimeType) };
}

const CLAIM_COLUMNS = `
  id,
  venue_id,
  claim_code_id,
  claimant_user_id,
  claimant_email,
  claimant_name,
  claimant_title,
  claimant_phone,
  proof_storage_path,
  proof_file_name,
  proof_mime_type,
  status,
  review_notes,
  submitted_at,
  reviewed_at,
  proof_cleared_at,
  venues(id, slug, name, city, state, address, owner_user_id)
`;

const CLAIM_CODE_COLUMNS = `
  id,
  venue_id,
  created_by,
  created_at,
  expires_at,
  used_at,
  used_by,
  revoked_at,
  revoked_by,
  venues(id, slug, name, city, state, owner_user_id)
`;

function mapClaim(row: any) {
  const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
  return {
    id: row.id,
    venueId: row.venue_id,
    claimCodeId: row.claim_code_id || null,
    claimantUserId: row.claimant_user_id,
    claimantEmail: row.claimant_email,
    claimantName: row.claimant_name,
    claimantTitle: row.claimant_title,
    claimantPhone: row.claimant_phone,
    proofFileName: row.proof_file_name,
    proofMimeType: row.proof_mime_type,
    status: row.status,
    reviewNotes: row.review_notes || null,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at || null,
    proofClearedAt: row.proof_cleared_at || null,
    venue: venue
      ? {
          id: venue.id,
          slug: venue.slug,
          name: venue.name,
          city: venue.city,
          state: venue.state || null,
          address: venue.address || null,
          isManaged: Boolean(venue.owner_user_id),
        }
      : null,
  };
}

function mapClaimCode(row: any) {
  const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
  const status = row.used_at
    ? "used"
    : row.revoked_at
      ? "revoked"
      : new Date(row.expires_at).getTime() <= Date.now()
        ? "expired"
        : "active";
  return {
    id: row.id,
    venueId: row.venue_id,
    status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at || null,
    revokedAt: row.revoked_at || null,
    venue: venue
      ? {
          id: venue.id,
          slug: venue.slug,
          name: venue.name,
          city: venue.city,
          state: venue.state || null,
          isManaged: Boolean(venue.owner_user_id),
        }
      : null,
  };
}

function createVenueClaimCodeValue() {
  const entropy = randomBytes(10).toString("hex").toUpperCase();
  return `DANCR-${entropy.match(/.{1,4}/g)?.join("-") || entropy}`;
}

function hashVenueClaimCode(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^DANCR[0-9A-F]{20}$/.test(normalized)) {
    throw new VenueClaimUserError("This venue claim code is invalid or no longer active.");
  }
  const secret = process.env.VENUE_CLAIM_CODE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Venue claim code hashing is not configured.");
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

function normalizedEmail(value: unknown) {
  const email = requiredText(value, "A business email is required.", 5, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new VenueClaimUserError("Enter a valid business email address.");
  }
  return email;
}

function requiredText(value: unknown, message: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw new VenueClaimUserError(message);
  return text;
}

function matchesFileSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function safeOriginalFileName(value: string, extension: string) {
  const base = value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .trim()
    .slice(0, 100) || "venue-proof";
  return `${base}.${extension}`;
}
