import type { SupabaseClient } from "@supabase/supabase-js";

export type DancerPublicationTransition =
  | "submit_for_venue_review"
  | "admin_accept"
  | "admin_reject"
  | "set_public"
  | "set_private";

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

function requiredString(value: unknown, field: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`DANCER_PUBLICATION_TRANSITION_MISSING_${field.toUpperCase()}`);
  return normalized;
}

function publicationState(profile: any): DancerPublicationState {
  return {
    id: requiredString(profile.id, "id"),
    userId: requiredString(profile.user_id, "user_id"),
    status: requiredString(profile.status, "status"),
    verificationStatus: requiredString(profile.verification_status, "verification_status"),
    approvedAt: profile.approved_at ? String(profile.approved_at) : null,
    isPublic: profile.is_public === true,
    disabledAt: profile.disabled_at ? String(profile.disabled_at) : null,
    venueApprovedAt: profile.venue_approved_at ? String(profile.venue_approved_at) : null,
    venueApprovedByUserId: profile.venue_approved_by_user_id ? String(profile.venue_approved_by_user_id) : null,
    venueApprovedVenueId: profile.venue_approved_venue_id ? String(profile.venue_approved_venue_id) : null,
  };
}

export async function transitionDancerPublication(
  client: SupabaseClient,
  dancerId: string,
  transition: DancerPublicationTransition,
  options: TransitionOptions = {},
): Promise<DancerPublicationState> {
  const db = client as any;
  const { data: profile, error: profileError } = await db
    .from("dancer_profiles")
    .select("id, user_id, stage_name, city, status, verification_status, photo_review_status, avatar_storage_path, approved_at, is_public, disabled_at, venue_approved_at, venue_approved_by_user_id, venue_approved_venue_id")
    .eq("id", dancerId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error("Dancer profile not found.");

  const { data: account, error: accountError } = await db
    .from("app_users")
    .select("id, role, account_state")
    .eq("id", profile.user_id)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account || account.role !== "dancer") throw new Error("Dancer account not found.");

  let actor: any = null;
  if (options.actorUserId) {
    const { data, error } = await db
      .from("app_users")
      .select("id, role, account_state")
      .eq("id", options.actorUserId)
      .maybeSingle();
    if (error) throw error;
    actor = data;
  }

  const actorIsOwner = options.actorUserId === profile.user_id;
  const actorIsAdmin = actor?.role === "admin" && actor?.account_state === "active";
  let update: Record<string, string | boolean | null>;

  if (transition === "submit_for_venue_review") {
    if (!actorIsOwner || profile.disabled_at || profile.status === "disabled") {
      throw new Error("Only the active dancer can submit this profile.");
    }
    update = { status: "pending_review", verification_status: "pending", approved_at: null, is_public: false };
  } else if (transition === "admin_accept" || transition === "admin_reject") {
    if (!actorIsAdmin) throw new Error("An active admin account is required.");
    const accepted = transition === "admin_accept";
    update = {
      status: accepted ? "pending_review" : "rejected",
      verification_status: accepted ? "pending" : "rejected",
      approved_at: null,
      is_public: false,
    };
  } else if (transition === "set_public" || transition === "set_private") {
    if (!actorIsOwner) throw new Error("Only the dancer can change profile visibility.");
    const makingPublic = transition === "set_public";
    if (
      makingPublic
      && (
        account.account_state !== "active"
        || profile.status !== "approved"
        || profile.verification_status !== "approved"
        || !profile.approved_at
        || !profile.venue_approved_at
        || profile.disabled_at
      )
    ) {
      throw new Error("Profile approval is required before reactivation.");
    }
    update = { is_public: makingPublic };
  } else {
    throw new Error("Unknown dancer publication transition.");
  }

  const { data: updated, error: updateError } = await db
    .from("dancer_profiles")
    .update(update)
    .eq("id", dancerId)
    .select("id, user_id, status, verification_status, approved_at, is_public, disabled_at, venue_approved_at, venue_approved_by_user_id, venue_approved_venue_id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) throw new Error("DANCER_PUBLICATION_TRANSITION_NOT_APPLIED");

  return publicationState(updated);
}
