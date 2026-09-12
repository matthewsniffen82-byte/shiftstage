import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

export type DancerPublicationTransition =
  | "submit_for_venue_review"
  | "admin_accept"
  | "admin_reject"
  | "set_public"
  | "set_private"
  | "disable"
  | "reactivate";

export type DancerPublicationState = {
  id: string;
  userId: string;
  status: string;
  verificationStatus: string;
  approvedAt: string | null;
  isPublic: boolean;
  disabledAt: string | null;
  venueApprovedAt: string | null;
  venueApprovedByUserId: string | null;
  venueApprovedVenueId: string | null;
};

type TransitionOptions = {
  actorUserId?: string | null;
};

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown) => value === null || typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
function unconfirmedPublication() {
  return new PublicApiError("UNAVAILABLE", "The profile change could not be confirmed. Refresh the profile and review its current state before trying again.", 503);
}

function publicationState(profile: any, dancerId: string, transition: DancerPublicationTransition, actorUserId?: string | null): DancerPublicationState {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)
    || !uuid(profile.id) || profile.id !== dancerId.toLowerCase() || !uuid(profile.user_id)
    || !["draft", "pending_review", "approved", "rejected", "disabled"].includes(profile.status)
    || !["pending", "approved", "rejected"].includes(profile.verification_status)
    || typeof profile.is_public !== "boolean"
    || ![profile.approved_at, profile.disabled_at, profile.venue_approved_at].every(timestamp)
    || ![profile.venue_approved_by_user_id, profile.venue_approved_venue_id].every(value => value === null || uuid(value))
    || (["submit_for_venue_review", "set_public", "set_private"].includes(transition) && profile.user_id !== actorUserId?.toLowerCase())
    || (profile.is_public && (profile.status !== "approved" || profile.verification_status !== "approved"
      || profile.approved_at === null || profile.venue_approved_at === null || profile.disabled_at !== null))) throw unconfirmedPublication();
  if ((["submit_for_venue_review", "admin_accept"].includes(transition) && (profile.status !== "pending_review"
      || profile.verification_status !== "pending" || profile.approved_at !== null || profile.is_public))
    || (transition === "admin_reject" && (profile.status !== "rejected" || profile.verification_status !== "rejected" || profile.approved_at !== null || profile.is_public))
    || (transition === "set_public" && !profile.is_public) || (transition === "set_private" && profile.is_public)
    || (transition === "disable" && (profile.status !== "disabled" || profile.disabled_at === null || profile.is_public))
    || (transition === "reactivate" && (profile.is_public !== (profile.status === "approved")
      || !["approved", "rejected", "pending_review", "disabled"].includes(profile.status)
      || (profile.status !== "disabled" && profile.disabled_at !== null)))) throw unconfirmedPublication();
  return {
    id: profile.id, userId: profile.user_id, status: profile.status, verificationStatus: profile.verification_status,
    approvedAt: profile.approved_at, isPublic: profile.is_public, disabledAt: profile.disabled_at,
    venueApprovedAt: profile.venue_approved_at, venueApprovedByUserId: profile.venue_approved_by_user_id,
    venueApprovedVenueId: profile.venue_approved_venue_id,
  };
}

export async function transitionDancerPublication(
  client: SupabaseClient,
  dancerId: string,
  transition: DancerPublicationTransition,
  options: TransitionOptions = {},
): Promise<DancerPublicationState> {
  let result;
  try {
    result = await client.rpc("transition_dancer_publication_safely", {
      p_dancer_id: dancerId, p_transition: transition, p_actor_user_id: options.actorUserId || null,
    });
  } catch {
    throw unconfirmedPublication();
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw unconfirmedPublication();
  if (result.error) {
    if (result.error.code === "42501") throw new PublicApiError("FORBIDDEN", "This profile change requires an active, authorized account.", 403);
    if (["22023", "40001"].includes(result.error.code)) throw new PublicApiError("CONFLICT", "This profile change is not available in its current state. Refresh and try again.", 409);
    if (result.error.code === "P0002") throw new PublicApiError("NOT_FOUND", "The profile is no longer available. Refresh the profile list.", 404);
    throw unconfirmedPublication();
  }
  return publicationState(result.data, dancerId, transition, options.actorUserId);
}
