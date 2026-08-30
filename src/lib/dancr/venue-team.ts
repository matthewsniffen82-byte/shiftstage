import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "./types";
import { requireVenueAccess, type VenueTeamRole } from "./venue-access";
import { safeErrorMetadata } from "../security/safe-error-metadata";

type DancrClient = SupabaseClient;
type AssignableVenueRole = Exclude<VenueTeamRole, "owner">;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TOKEN_PATTERN = /^vti_[A-Za-z0-9_-]{40,120}$/;

export async function getVenueTeamState(client: DancrClient, actorUserId: string) {
  const access = await requireVenueAccess(client, actorUserId, "view_team");
  const memberQuery = (client as any)
    .from("venue_team_members")
    .select("id, user_id, role, status, joined_at, removed_at, updated_at, account:app_users!venue_team_members_user_id_fkey(display_name, email, account_state)")
    .eq("venue_id", access.venueId)
    .order("status", { ascending: true })
    .order("updated_at", { ascending: false });
  const invitationQuery = access.role === "owner"
    ? (client as any)
        .from("venue_team_invitations")
        .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
        .eq("venue_id", access.venueId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [], error: null });
  const [{ data: members, error: memberError }, { data: invitations, error: invitationError }, activity] = await Promise.all([
    memberQuery,
    invitationQuery,
    listVenueActivity(client, access.venueId, 40),
  ]);
  if (memberError) throw memberError;
  if (invitationError) throw invitationError;

  return {
    access,
    members: (members || []).map(mapMember),
    invitations: (invitations || []).map(mapInvitation),
    activity,
  };
}

export async function createVenueTeamInvitation(
  client: DancrClient,
  input: { actorUserId: string; email: string; role: AssignableVenueRole; expiresInDays?: number },
) {
  const access = await requireVenueAccess(client, input.actorUserId, "manage_team");
  const email = normalizeEmail(input.email);
  const role = normalizeAssignableRole(input.role);
  const expiresInDays = Math.max(1, Math.min(14, Number(input.expiresInDays || 7)));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

  const { data: ownerAccount, error: ownerAccountError } = await (client as any)
    .from("app_users")
    .select("email")
    .eq("id", input.actorUserId)
    .maybeSingle();
  if (ownerAccountError) throw ownerAccountError;
  if (String(ownerAccount?.email || "").toLowerCase() === email) {
    throw new Error("The venue owner already has full access.");
  }

  const { data: existingAccount, error: accountError } = await (client as any)
    .from("app_users")
    .select("id, role, account_state")
    .ilike("email", email)
    .maybeSingle();
  if (accountError) throw accountError;
  if (existingAccount && (existingAccount.role !== "venue" || existingAccount.account_state !== "active")) {
    throw new Error("That email belongs to a different MyDancr account type.");
  }

  const { data: existingMember, error: existingMemberError } = existingAccount
    ? await (client as any)
        .from("venue_team_members")
        .select("id, venue_id, status, venues(name)")
        .eq("user_id", existingAccount.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (existingMemberError) throw existingMemberError;
  if (existingMember?.status === "active") {
    const existingVenue = firstJoined(existingMember.venues);
    throw new Error(
      existingMember.venue_id === access.venueId
        ? "That person already has venue team access."
        : `That person already belongs to ${String(existingVenue?.name || "another venue")} on MyDancr.`,
    );
  }

  const { error: revokeError } = await (client as any)
    .from("venue_team_invitations")
    .update({ revoked_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("venue_id", access.venueId)
    .ilike("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (revokeError) throw revokeError;

  const token = `vti_${crypto.randomBytes(36).toString("base64url")}`;
  const { data, error } = await (client as any)
    .from("venue_team_invitations")
    .insert({
      venue_id: access.venueId,
      email,
      role,
      token_digest: hashInvitationToken(token),
      invited_by_user_id: input.actorUserId,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
    .single();
  if (error) throw error;

  await recordVenueActivity(client, {
    venueId: access.venueId,
    actorUserId: input.actorUserId,
    actorRole: access.role,
    action: "team.invitation_created",
    targetType: "venue_team_invitation",
    targetId: String(data.id),
    summary: `${email} was invited as ${role}.`,
    metadata: { email, role, expiresAt: expiresAt.toISOString() },
  });

  return { invitation: mapInvitation(data), token, access };
}

export async function resolveVenueTeamInvitation(
  client: DancrClient,
  token: string,
  expectedEmail?: string,
) {
  if (!INVITE_TOKEN_PATTERN.test(token)) throw new Error("This venue team invitation is invalid.");
  const { data, error } = await (client as any)
    .from("venue_team_invitations")
    .select("id, venue_id, email, role, expires_at, accepted_at, revoked_at, created_at, venues(id, name, slug, city, state, is_active)")
    .eq("token_digest", hashInvitationToken(token))
    .maybeSingle();
  if (error) throw error;
  const venue = firstJoined(data?.venues);
  if (
    !data
    || !venue
    || venue.is_active !== true
    || data.accepted_at
    || data.revoked_at
    || new Date(data.expires_at).getTime() <= Date.now()
  ) {
    throw new Error("This venue team invitation is no longer active.");
  }
  if (expectedEmail && normalizeEmail(expectedEmail) !== String(data.email).toLowerCase()) {
    throw new Error("Use the email address that received this venue team invitation.");
  }
  return {
    invitationId: String(data.id),
    email: String(data.email),
    role: normalizeAssignableRole(data.role),
    expiresAt: String(data.expires_at),
    venue: {
      id: String(venue.id),
      name: String(venue.name),
      slug: String(venue.slug),
      city: String(venue.city),
      state: venue.state ? String(venue.state) : null,
    },
  };
}

export async function redeemVenueTeamInvitation(
  client: DancrClient,
  input: { token: string; userId: string; email: string },
) {
  const invitation = await resolveVenueTeamInvitation(client, input.token, input.email);
  const { data, error } = await (client as any).rpc("redeem_venue_team_invitation", {
    p_invitation_id: invitation.invitationId,
    p_user_id: input.userId,
  });
  if (error) throw error;
  await recordVenueActivity(client, {
    venueId: invitation.venue.id,
    actorUserId: input.userId,
    actorRole: invitation.role,
    action: "team.invitation_accepted",
    targetType: "venue_team_member",
    targetId: String(data?.id || input.userId),
    summary: `${input.email.toLowerCase()} joined as ${invitation.role}.`,
    metadata: { email: input.email.toLowerCase(), role: invitation.role },
  });
  return { invitation, member: data };
}

export async function updateVenueTeamMember(
  client: DancrClient,
  input: { actorUserId: string; memberId: string; role?: AssignableVenueRole; remove?: boolean },
) {
  const access = await requireVenueAccess(client, input.actorUserId, "manage_team");
  const { data: current, error: currentError } = await (client as any)
    .from("venue_team_members")
    .select("id, user_id, role, status, account:app_users!venue_team_members_user_id_fkey(display_name, email, account_state)")
    .eq("id", requiredId(input.memberId))
    .eq("venue_id", access.venueId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new Error("Venue team member not found.");

  const now = new Date().toISOString();
  const update = input.remove
    ? { status: "removed", removed_at: now, updated_at: now }
    : { role: normalizeAssignableRole(input.role), status: "active", removed_at: null, updated_at: now };
  const { data, error } = await (client as any)
    .from("venue_team_members")
    .update(update)
    .eq("id", current.id)
    .eq("venue_id", access.venueId)
    .select("id, user_id, role, status, joined_at, removed_at, updated_at, account:app_users!venue_team_members_user_id_fkey(display_name, email, account_state)")
    .single();
  if (error) throw error;
  const person = firstJoined(current.account);
  const label = String(person?.display_name || person?.email || "Team member");
  await recordVenueActivity(client, {
    venueId: access.venueId,
    actorUserId: input.actorUserId,
    actorRole: access.role,
    action: input.remove ? "team.access_removed" : "team.role_updated",
    targetType: "venue_team_member",
    targetId: String(current.id),
    summary: input.remove ? `${label}'s venue access was removed.` : `${label} is now a ${String(update.role)}.`,
    metadata: { previousRole: current.role, nextRole: input.remove ? null : update.role },
  });
  return mapMember(data);
}

export async function revokeVenueTeamInvitation(
  client: DancrClient,
  input: { actorUserId: string; invitationId: string },
) {
  const access = await requireVenueAccess(client, input.actorUserId, "manage_team");
  const now = new Date().toISOString();
  const { data, error } = await (client as any)
    .from("venue_team_invitations")
    .update({ revoked_at: now, updated_at: now })
    .eq("id", requiredId(input.invitationId))
    .eq("venue_id", access.venueId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, email, role")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Active invitation not found.");
  await recordVenueActivity(client, {
    venueId: access.venueId,
    actorUserId: input.actorUserId,
    actorRole: access.role,
    action: "team.invitation_revoked",
    targetType: "venue_team_invitation",
    targetId: String(data.id),
    summary: `The invitation for ${String(data.email)} was revoked.`,
  });
}

export async function listVenueActivity(client: DancrClient, venueId: string, limit = 40) {
  const { data, error } = await (client as any)
    .from("venue_activity_log")
    .select("id, actor_user_id, actor_role, action, target_type, target_id, summary, metadata, created_at, app_users(display_name, email)")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) throw error;
  return (data || []).map((row: any) => {
    const actor = firstJoined(row.app_users);
    return {
      id: String(row.id),
      actorRole: String(row.actor_role),
      actorName: String(actor?.display_name || actor?.email || (row.actor_role === "system" ? "MyDancr" : "Former team member")),
      action: String(row.action),
      summary: String(row.summary),
      createdAt: String(row.created_at),
    };
  });
}

export async function recordVenueActivity(client: DancrClient, input: {
  venueId: string;
  actorUserId?: string | null;
  actorRole: VenueTeamRole | "admin" | "system";
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, Json | undefined>;
}) {
  const { error } = await (client as any).from("venue_activity_log").insert({
    venue_id: input.venueId,
    actor_user_id: input.actorUserId || null,
    actor_role: input.actorRole,
    action: input.action.slice(0, 100),
    target_type: input.targetType || null,
    target_id: input.targetId || null,
    summary: input.summary.slice(0, 300),
    metadata: input.metadata || {},
  });
  if (error) {
    console.error("VENUE_ACTIVITY_LOG_FAILED", {
      venueId: input.venueId,
      action: input.action,
      ...safeErrorMetadata(error),
    });
    return false;
  }
  return true;
}

function mapMember(row: any) {
  const account = firstJoined(row.account);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    role: normalizeAssignableRole(row.role),
    status: String(row.status),
    displayName: String(account?.display_name || account?.email || "Team member"),
    email: String(account?.email || ""),
    accountState: String(account?.account_state || "active"),
    joinedAt: String(row.joined_at || row.updated_at),
    removedAt: row.removed_at ? String(row.removed_at) : null,
  };
}

function mapInvitation(row: any) {
  return {
    id: String(row.id),
    email: String(row.email),
    role: normalizeAssignableRole(row.role),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  };
}

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 320) throw new Error("Enter a valid staff email address.");
  return email;
}

function normalizeAssignableRole(value: unknown): AssignableVenueRole {
  if (value === "manager" || value === "staff") return value;
  throw new Error("Choose manager or staff access.");
}

function requiredId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("A valid venue team record is required.");
  }
  return id;
}

function hashInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function firstJoined(value: unknown): any {
  return Array.isArray(value) ? value[0] || null : value || null;
}
