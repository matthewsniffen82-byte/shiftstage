import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail } from "./notification-delivery";
import { publicAppUrl } from "./public-app-url";
import {
  createVenueSignupCredential,
  hashVenueClaimRequestIp,
} from "./venue-claims";
import { safeErrorMetadata } from "../security/safe-error-metadata";

type DancrClient = SupabaseClient;

const MAX_REQUESTS_PER_IP_PER_DAY = 3;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUEST_COLUMNS = `
  id,
  venue_name,
  street_address,
  city,
  state,
  postal_code,
  website,
  contact_name,
  contact_title,
  contact_email,
  contact_phone,
  message,
  status,
  matched_venue_id,
  access_code_id,
  referring_agent_id,
  referring_agent:sales_agents!venue_signup_requests_referring_agent_id_fkey(
    id,
    status,
    account:app_users!sales_agents_user_id_fkey(display_name, email)
  ),
  reviewed_by,
  review_notes,
  submitted_at,
  reviewed_at,
  updated_at
`;

export class VenueSignupRequestUserError extends Error {}

export type VenueSignupRequestInput = {
  venueName?: unknown;
  streetAddress?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
  website?: unknown;
  contactName?: unknown;
  contactTitle?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  message?: unknown;
  authorizedToRepresentVenue?: unknown;
  agentReferralCode?: unknown;
};

export async function createVenueSignupRequest(
  client: DancrClient,
  input: VenueSignupRequestInput,
  requestIp: string,
) {
  const normalized = normalizeVenueSignupRequest(input);
  const referringAgentId = await resolveReferringAgent(client, input.agentReferralCode);
  const requestIpHash = hashVenueClaimRequestIp(requestIp);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const db = client as any;

  const [{ count, error: rateError }, { data: duplicate, error: duplicateError }] = await Promise.all([
    db
      .from("venue_signup_requests")
      .select("id", { count: "exact", head: true })
      .eq("request_ip_hash", requestIpHash)
      .gte("submitted_at", since),
    db
      .from("venue_signup_requests")
      .select("id, status")
      .eq("status", "pending")
      .ilike("venue_name", escapeLike(normalized.venueName))
      .ilike("street_address", escapeLike(normalized.streetAddress))
      .ilike("contact_email", escapeLike(normalized.contactEmail))
      .maybeSingle(),
  ]);
  if (rateError) throw rateError;
  if (duplicateError) throw duplicateError;
  if ((count || 0) >= MAX_REQUESTS_PER_IP_PER_DAY) {
    throw new VenueSignupRequestUserError("Too many venue requests were submitted. Try again tomorrow.");
  }
  if (duplicate) {
    throw new VenueSignupRequestUserError("This venue request is already waiting for review.");
  }

  const { data, error } = await db
    .from("venue_signup_requests")
    .insert({
      venue_name: normalized.venueName,
      street_address: normalized.streetAddress,
      city: normalized.city,
      state: normalized.state,
      postal_code: normalized.postalCode,
      website: normalized.website,
      contact_name: normalized.contactName,
      contact_title: normalized.contactTitle,
      contact_email: normalized.contactEmail,
      contact_phone: normalized.contactPhone,
      message: normalized.message,
      request_ip_hash: requestIpHash,
      referring_agent_id: referringAgentId,
    })
    .select(REQUEST_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new VenueSignupRequestUserError("This venue request is already waiting for review.");
    }
    throw error;
  }

  console.info("VENUE_SIGNUP_REQUEST_SUBMITTED", {
    requestId: data.id,
    city: data.city,
  });
  return mapVenueSignupRequest(data);
}

export async function getAdminVenueSignupRequests(client: DancrClient, status = "pending") {
  let query = (client as any)
    .from("venue_signup_requests")
    .select(REQUEST_COLUMNS)
    .order("submitted_at", { ascending: true })
    .limit(250);

  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapVenueSignupRequest);
}

export async function reviewVenueSignupRequest(
  client: DancrClient,
  input: {
    requestId: string;
    adminId: string;
    decision: "approved" | "rejected";
    notes?: string | null;
    confirmAgentReferral?: boolean;
  },
) {
  const requestId = requiredText(input.requestId, "Venue signup request is required.", 1, 80);
  const adminId = requiredText(input.adminId, "Admin account is required.", 1, 80);
  const notes = optionalText(input.notes, 2000);

  if (input.decision === "rejected" && !notes) {
    throw new VenueSignupRequestUserError("Add a reason before rejecting this venue request.");
  }

  const { data: pendingRequest, error: pendingRequestError } = await (client as any)
    .from("venue_signup_requests")
    .select("id, referring_agent_id")
    .eq("id", requestId)
    .maybeSingle();
  if (pendingRequestError) throw pendingRequestError;
  if (!pendingRequest) throw new VenueSignupRequestUserError("Venue signup request not found.");
  if (input.decision === "approved" && pendingRequest.referring_agent_id && input.confirmAgentReferral !== true) {
    throw new VenueSignupRequestUserError("Confirm the referring agent before approving this venue request.");
  }

  const credential = input.decision === "approved" ? createVenueSignupCredential() : null;
  const expiresAt = credential
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const { data, error } = await (client as any).rpc("review_venue_signup_request", {
    p_request_id: requestId,
    p_admin_id: adminId,
    p_decision: input.decision,
    p_existing_venue_id: null,
    p_review_notes: notes,
    p_code_digest: credential?.digest || null,
    p_code_expires_at: expiresAt,
  });

  if (error) {
    const message = String(error.message || "");
    if (/already reviewed|not found|selected venue|reason before rejecting|access code/i.test(message)) {
      throw new VenueSignupRequestUserError(message);
    }
    throw error;
  }

  const request = mapVenueSignupRequest(data?.request || {});
  const venue = mapApprovedVenue(data?.venue || null);
  const claimCode = mapApprovedClaimCode(data?.claim_code || null);
  let emailDelivery: { delivered: boolean; reason?: string } | null = null;

  if (credential && venue) {
    emailDelivery = await deliverVenueAccessCode({
      request,
      venue,
      code: credential.code,
      expiresAt: claimCode?.expiresAt || expiresAt || "",
    }).catch((deliveryError) => {
      console.warn("VENUE_SIGNUP_REQUEST_EMAIL_FAILED", {
        requestId,
        ...safeErrorMetadata(deliveryError),
      });
      return { delivered: false, reason: "delivery_failed" };
    });
  }

  console.info("VENUE_SIGNUP_REQUEST_REVIEWED", {
    requestId,
    decision: input.decision,
    venueId: venue?.id || null,
    adminId,
    emailDelivered: emailDelivery?.delivered || false,
  });

  return {
    request,
    venue,
    claimCode,
    accessCode: credential?.code || null,
    emailDelivery,
  };
}

function normalizeVenueSignupRequest(input: VenueSignupRequestInput) {
  if (input.authorizedToRepresentVenue !== true) {
    throw new VenueSignupRequestUserError("Confirm that you are authorized to request access for this venue.");
  }

  const contactEmail = requiredText(input.contactEmail, "Enter a valid business email address.", 5, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(contactEmail)) {
    throw new VenueSignupRequestUserError("Enter a valid business email address.");
  }

  const contactPhone = requiredText(input.contactPhone, "Enter a reachable business phone number.", 7, 40);
  if ((contactPhone.match(/\d/g) || []).length < 7) {
    throw new VenueSignupRequestUserError("Enter a reachable business phone number.");
  }

  return {
    venueName: requiredText(input.venueName, "Venue name is required.", 2, 160),
    streetAddress: requiredText(input.streetAddress, "Public street address is required.", 5, 240),
    city: requiredText(input.city, "City is required.", 2, 120),
    state: requiredText(input.state, "State is required.", 2, 40),
    postalCode: requiredText(input.postalCode, "ZIP or postal code is required.", 3, 16),
    website: normalizeWebsite(input.website),
    contactName: requiredText(input.contactName, "Your full name is required.", 2, 160),
    contactTitle: requiredText(input.contactTitle, "Your position at the venue is required.", 2, 120),
    contactEmail,
    contactPhone,
    message: optionalText(input.message, 1500),
  };
}

function normalizeWebsite(value: unknown) {
  const text = optionalText(value, 320);
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".") || url.username || url.password) throw new Error("invalid");
    url.hash = "";
    return url.toString();
  } catch {
    throw new VenueSignupRequestUserError("Enter a valid venue website address.");
  }
}

async function deliverVenueAccessCode(input: {
  request: ReturnType<typeof mapVenueSignupRequest>;
  venue: NonNullable<ReturnType<typeof mapApprovedVenue>>;
  code: string;
  expiresAt: string;
}) {
  const baseUrl = publicAppUrl();
  const signupUrl = new URL("/?venueAccess=1&venueMode=signup", baseUrl).toString();
  const expiration = input.expiresAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Los_Angeles" }).format(new Date(input.expiresAt))
    : "seven days";
  const text = [
    `Hi ${input.request.contactName},`,
    "",
    `Your request to join MyDancr as ${input.venue.name} was approved.`,
    "",
    `Private one-time access code: ${input.code}`,
    `Expires: ${expiration} Pacific Time`,
    "",
    `Open ${signupUrl} and paste this code to create the club manager account.`,
    "Do not forward this code. It can be used once and only for the approved venue.",
    "After sign up, MyDancr will prepare the private venue page. Your dashboard will notify you when it is ready to approve or return with corrections.",
    "",
    "MyDancr",
  ].join("\n");
  const html = `
    <p>Hi ${escapeHtml(input.request.contactName)},</p>
    <p>Your request to join MyDancr as <strong>${escapeHtml(input.venue.name)}</strong> was approved.</p>
    <p>Private one-time access code:</p>
    <p style="font-family:monospace;font-size:18px;font-weight:700;letter-spacing:.04em">${escapeHtml(input.code)}</p>
    <p>Expires ${escapeHtml(expiration)} Pacific Time.</p>
    <p><a href="${escapeHtml(signupUrl)}">Continue venue setup on MyDancr</a>, then paste this code to create the club manager account.</p>
    <p>Do not forward this code. It can be used once and only for the approved venue.</p>
    <p>After sign up, MyDancr will prepare the private venue page. Your dashboard will notify you when it is ready to approve or return with corrections.</p>
  `;

  return sendTransactionalEmail({
    to: input.request.contactEmail,
    subject: `Your MyDancr access for ${input.venue.name}`,
    text,
    html,
  });
}

function mapVenueSignupRequest(row: any) {
  return {
    id: String(row.id || ""),
    venueName: String(row.venue_name || ""),
    streetAddress: String(row.street_address || ""),
    city: String(row.city || ""),
    state: String(row.state || ""),
    postalCode: String(row.postal_code || ""),
    website: row.website ? String(row.website) : null,
    contactName: String(row.contact_name || ""),
    contactTitle: String(row.contact_title || ""),
    contactEmail: String(row.contact_email || ""),
    contactPhone: String(row.contact_phone || ""),
    message: row.message ? String(row.message) : null,
    status: String(row.status || "pending"),
    matchedVenueId: row.matched_venue_id ? String(row.matched_venue_id) : null,
    accessCodeId: row.access_code_id ? String(row.access_code_id) : null,
    referringAgentId: row.referring_agent_id ? String(row.referring_agent_id) : null,
    referringAgentName: agentAccountLabel(row.referring_agent),
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

async function resolveReferringAgent(client: DancrClient, value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{36}$/.test(code)) {
    throw new VenueSignupRequestUserError("This agent referral link is invalid or no longer active.");
  }
  const { data, error } = await (client as any)
    .from("sales_agents")
    .select("id")
    .eq("referral_code", code)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new VenueSignupRequestUserError("This agent referral link is invalid or no longer active.");
  }
  return String(data.id);
}

function agentAccountLabel(value: any) {
  const agent = Array.isArray(value) ? value[0] || null : value || null;
  const account = Array.isArray(agent?.account) ? agent.account[0] || null : agent?.account || null;
  if (!account) return null;
  return String(account.display_name || account.email || "Sales agent");
}

function mapApprovedVenue(row: any) {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    slug: String(row.slug || ""),
    name: String(row.name || ""),
    city: String(row.city || ""),
    state: row.state ? String(row.state) : null,
    address: row.address ? String(row.address) : null,
    isActive: row.is_active !== false,
  };
}

function mapApprovedClaimCode(row: any) {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    venueId: String(row.venue_id || ""),
    status: row.used_at ? "used" : row.revoked_at ? "revoked" : "active",
    createdAt: String(row.created_at || ""),
    expiresAt: String(row.expires_at || ""),
  };
}

function requiredText(value: unknown, message: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (text.length < min || text.length > max) throw new VenueSignupRequestUserError(message);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > max) throw new VenueSignupRequestUserError("One or more fields are too long.");
  return text;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}
