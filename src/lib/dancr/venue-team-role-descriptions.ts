import type { VenueTeamRole } from "./venue-access";

export const VENUE_TEAM_ROLE_DESCRIPTIONS: Record<Exclude<VenueTeamRole, "owner">, {
  label: string;
  view: string;
  actions: string;
}> = {
  manager: {
    label: "Manager",
    view: "Dashboard, analytics, Club Deals, dancers, tap stickers, and team activity.",
    actions: "Edit the club profile, manage dancer access, end check-ins, request Club Deal changes, and request sticker support.",
  },
  staff: {
    label: "Staff",
    view: "Dashboard, analytics, Club Deals, dancers, and tap stickers. No team activity.",
    actions: "End check-ins and request sticker support. Cannot edit the club profile, manage dancer access, or request Club Deal changes.",
  },
};

export const VENUE_TEAM_OWNER_ACCESS_NOTE = "Only the owner can invite or remove team members, change their access levels, or remove the club from MyDancr. Owner access cannot be granted by invitation.";
