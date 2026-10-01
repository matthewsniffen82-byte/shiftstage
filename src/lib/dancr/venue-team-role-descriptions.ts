import type { VenueTeamRole } from "./venue-access";

export const VENUE_TEAM_ROLE_DESCRIPTIONS: Record<Exclude<VenueTeamRole, "owner">, {
  label: string;
  view: string;
  actions: string;
}> = {
  manager: {
    label: "Manager",
    view: "Dashboard · Results · Club Deals · Dancers · Stickers · Team activity",
    actions: "Edit profile · Manage dancer access · End check-ins · Request deal changes · Sticker support",
  },
  staff: {
    label: "Staff",
    view: "Dashboard · Results · Club Deals · Dancers · Stickers. No team activity.",
    actions: "End check-ins · Sticker support. No profile editing, dancer-access management, or deal-change requests.",
  },
};

export const VENUE_TEAM_OWNER_ACCESS_NOTE = "Only the owner can invite or remove team members, change their access levels, or remove the club from MyDancr. Owner access cannot be granted by invitation.";
