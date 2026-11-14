// Only these topic IDs may appear in browsing, answers or suggestions for a section.
export const HELP_SECTIONS = {
  "customer-night": { label: "My Night", topics: ["guest-night", "guest-working"] },
  "customer-saved": { label: "Saved", topics: ["guest-follow", "guest-saved-deals"] },
  "customer-saved-dancers": { label: "Saved dancers", topics: ["guest-saved-dancers"] },
  "customer-saved-clubs": { label: "Saved clubs", topics: ["guest-saved-clubs"] },
  "customer-saved-deals": { label: "Saved deals", topics: ["guest-saved-deals"] },
  "customer-alerts": { label: "Alerts", topics: ["guest-alerts", "guest-push"] },
  "customer-account": { label: "Guest account", topics: ["guest-privacy", "guest-marketing", "account-credentials", "account-pause"] },
  "dancer-overview": { label: "Dancer overview", topics: ["dancer-checkin", "dancer-visibility", "dancer-schedule", "dancer-requests"] },
  "dancer-profile": { label: "Dancer profile", topics: ["dancer-photos", "dancer-avatar", "dancer-profile-visibility", "dancer-club-media"] },
  "dancer-results": { label: "Dancer results", topics: ["dancer-results"] },
  "dancer-videos": { label: "Video uploads", topics: ["dancer-videos"] },
  "dancer-account": { label: "Dancer account", topics: ["account-credentials", "account-pause", "dancer-notifications", "guides"] },
  "setup-details": { label: "Name & city", topics: ["setup-details"] },
  "setup-media": { label: "Photos & videos", topics: ["setup-media"] },
  "setup-agreement": { label: "Dancer agreement", topics: ["setup-agreement"] },
  "setup-age": { label: "Verify 18+", topics: ["setup-age"] },
  "setup-club": { label: "Club & media approval", topics: ["setup-club", "setup-review"] },
  "setup-account": { label: "Setup account settings", topics: ["account-credentials", "account-pause"] },
  "dancer-verification": { label: "Verification status", topics: ["dancer-verification"] },
  "dancer-notifications": { label: "Dancer notifications", topics: ["dancer-notifications"] },
  "venue-tonight": { label: "Tonight", topics: ["club-tonight"] },
  "venue-guest-list": { label: "Tonight · Guest list", topics: ["club-guest-list", "club-tonight"] },
  "venue-pickups": { label: "Ride requests", topics: ["club-rides"] },
  "venue-vip": { label: "VIP requests", topics: ["club-vip"] },
  "venue-vip-members": { label: "VIP guests", topics: ["club-vip-members"] },
  "venue-vip-invitations": { label: "VIP invitations", topics: ["club-vip-invitations"] },
  "venue-roster": { label: "Dancer roster", topics: ["club-roster"] },
  "venue-tables": { label: "Table requests", topics: ["club-tables", "club-table-alerts"] },
  "venue-media": { label: "Media updates", topics: ["club-media"] },
  "venue-new-dancers": { label: "Approvals", topics: ["club-new-dancers", "club-media"] },
  "venue-profile-review": { label: "New dancer review", topics: ["club-new-dancers"] },
  "venue-results": { label: "Club results", topics: ["club-results"] },
  "venue-page": { label: "Club page & deals", topics: ["club-page-info", "club-publish", "club-deals", "club-internal", "club-website"] },
  "venue-hidden-page": { label: "Hidden club page", topics: ["club-page-info", "club-hidden", "club-deals", "club-internal"] },
  "venue-setup": { label: "First club page approval", topics: ["club-first-page", "club-setup-status", "club-internal"] },
  "venue-contacts": { label: "Contacts & marketing", topics: ["club-contacts", "club-offers"] },
  "venue-team": { label: "Team & activity", topics: ["club-team"] },
  "venue-team-manager": { label: "Team activity", topics: ["club-team-manager"] },
  "venue-account": { label: "Club account", topics: ["club-account", "club-notifications", "club-owner-account", "club-team-account"] },
  "venue-tools": { label: "Club tools", topics: ["club-stickers", "club-tv", "guides"] },
  "venue-setup-tools": { label: "Club setup tools", topics: ["club-stickers", "guides"] },
  "venue-internal": { label: "Internal club view", topics: ["club-floor", "club-tables", "club-table-alerts"] },
  "vip-access": { label: "VIP invitation", topics: ["vip-access"] },
  "vip-overview": { label: "VIP overview", topics: ["vip-overview", "vip-requests"] },
  "vip-plan": { label: "Plan a VIP visit", topics: ["vip-plan"] },
  "vip-requests": { label: "VIP requests", topics: ["vip-requests"] },
  "vip-account": { label: "VIP account", topics: ["vip-access", "account-credentials", "vip-notifications", "vip-delete"] },
  "admin-home": { label: "Admin overview", topics: ["admin-overview"] },
  "admin-media": { label: "Review media", topics: ["admin-review"] },
  "admin-reports": { label: "Content reports", topics: ["admin-reports"] },
  "admin-clubs": { label: "Club accounts", topics: ["admin-clubs"] },
  "admin-club-requests": { label: "Club requests", topics: ["admin-club-requests"] },
  "admin-guests": { label: "Guest operations", topics: ["admin-guests"] },
  "admin-club-tools": { label: "Club tools", topics: ["admin-club-tools"] },
  "admin-people": { label: "People", topics: ["admin-people"] },
  "admin-money": { label: "Billing", topics: ["admin-billing"] },
  "admin-support": { label: "Support messages", topics: ["admin-support"] },
  "admin-support-staff": { label: "Support workspace", topics: ["admin-support", "admin-people", "admin-history"] },
  "admin-compliance": { label: "Safety & privacy cases", topics: ["admin-safety-privacy"] },
  "admin-platform": { label: "Platform", topics: ["admin-platform", "admin-copyright"] },
  "admin-team": { label: "Staff access", topics: ["admin-access", "admin-team"] },
  "admin-history": { label: "Archive", topics: ["admin-history"] },
  "admin-account": { label: "Admin account", topics: ["admin-account"] },
  "account-paused": { label: "Account recovery", topics: ["account-paused"] },
  "support-only": { label: "Support", topics: [] },
} as const;

export type HelpSection = keyof typeof HELP_SECTIONS;
export type HelpContext = "dashboard" | "dancer-onboarding" | "venue-approval" | HelpSection;

export function helpSection(context: HelpContext) {
  return Object.hasOwn(HELP_SECTIONS, context) ? HELP_SECTIONS[context as HelpSection] : null;
}

export function adminHelpContext(role: string, workspace: string, review: string, club: string, tool: string): HelpContext {
  if (role === "compliance") return "admin-compliance";
  if (role === "reviewer") return "admin-media";
  if (role === "billing") return "admin-money";
  if (role === "support") return "admin-support-staff";
  if (workspace === "approvals") return review === "reports" ? "admin-reports" : "admin-media";
  if (workspace === "clubs") return club === "requests" ? "admin-club-requests" : club === "guests" ? "admin-guests" : club === "tools" ? "admin-club-tools" : "admin-clubs";
  if (workspace === "more") return tool === "compliance" ? "admin-compliance" : tool === "team" ? "admin-team" : tool === "history" ? "admin-history" : tool === "platform" ? "admin-platform" : "admin-support";
  return workspace === "people" ? "admin-people" : workspace === "money" ? "admin-money" : "admin-home";
}

export function helpContextForSection(id: string): HelpContext | undefined {
  return ({ "venue-team": "venue-team", "venue-account": "venue-account", "dancer-account": "dancer-account", "dancer-account-settings": "dancer-account", "dancer-verification": "dancer-verification", "dancer-notifications": "dancer-notifications" } as Record<string, HelpContext>)[id];
}

export function dancerSetupHelpContext(step: string, agreement: boolean): HelpContext {
  if (step === "dancer-onboarding-age") return "setup-age";
  if (step === "dancer-onboarding-nfc") return "setup-club";
  return agreement ? "setup-agreement" : "setup-details";
}
