import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export type VenueTeamRole = "owner" | "manager" | "staff";
export type VenuePermission =
  | "view_dashboard"
  | "view_analytics"
  | "view_nfc"
  | "view_roster"
  | "view_deals"
  | "view_finance"
  | "view_team"
  | "manage_profile"
  | "manage_deals"
  | "manage_roster"
  | "manage_team"
  | "request_nfc_support";

export type VenueAccess = {
  venueId: string;
  venueName: string;
  venueSlug: string;
  role: VenueTeamRole;
  permissions: VenuePermission[];
};

const ROLE_PERMISSIONS: Record<VenueTeamRole, VenuePermission[]> = {
  owner: [
    "view_dashboard",
    "view_analytics",
    "view_nfc",
    "view_roster",
    "view_deals",
    "view_finance",
    "view_team",
    "manage_profile",
    "manage_deals",
    "manage_roster",
    "manage_team",
    "request_nfc_support",
  ],
  manager: [
    "view_dashboard",
    "view_analytics",
    "view_nfc",
    "view_roster",
    "view_deals",
    "view_finance",
    "view_team",
    "manage_profile",
    "manage_deals",
    "manage_roster",
    "request_nfc_support",
  ],
  staff: [
    "view_dashboard",
    "view_analytics",
    "view_nfc",
    "view_roster",
    "view_deals",
    "request_nfc_support",
  ],
};

const VENUE_ACCESS_COLUMNS = "id, name, slug, is_active, owner_user_id";

export async function getVenueAccess(client: DancrClient, userId: string): Promise<VenueAccess | null> {
  const { data: account, error: accountError } = await (client as any)
    .from("app_users")
    .select("id, role, account_state")
    .eq("id", userId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account || account.role !== "venue" || account.account_state !== "active") return null;

  const { data: ownedVenue, error: ownerError } = await (client as any)
    .from("venues")
    .select(VENUE_ACCESS_COLUMNS)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (ownedVenue) return mapVenueAccess(ownedVenue, "owner");

  const { data: membership, error: membershipError } = await (client as any)
    .from("venue_team_members")
    .select(`role, status, venues!inner(${VENUE_ACCESS_COLUMNS})`)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;
  const venue = firstJoined(membership?.venues);
  if (!membership || !venue || !isVenueTeamRole(membership.role)) return null;
  return mapVenueAccess(venue, membership.role);
}

export async function requireVenueAccess(
  client: DancrClient,
  userId: string,
  permission: VenuePermission = "view_dashboard",
) {
  const access = await getVenueAccess(client, userId);
  if (!access) throw new Error("An active venue account is required.");
  if (!access.permissions.includes(permission)) {
    throw new Error("Your venue team role does not allow this action.");
  }
  return access;
}

export function canVenue(access: VenueAccess | null | undefined, permission: VenuePermission) {
  return Boolean(access?.permissions.includes(permission));
}

function mapVenueAccess(venue: any, role: VenueTeamRole): VenueAccess {
  return {
    venueId: String(venue.id),
    venueName: String(venue.name),
    venueSlug: String(venue.slug),
    role,
    permissions: [...ROLE_PERMISSIONS[role]],
  };
}

function isVenueTeamRole(value: unknown): value is Exclude<VenueTeamRole, "owner"> {
  return value === "manager" || value === "staff";
}

function firstJoined(value: unknown): any {
  return Array.isArray(value) ? value[0] || null : value || null;
}
