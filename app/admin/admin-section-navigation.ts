export const ADMIN_REVIEW_SECTIONS = [
  { id: "media", label: "Photos & videos" },
  { id: "profiles", label: "Applications & links" },
  { id: "reports", label: "Reports" },
] as const;

export const ADMIN_CLUB_SECTIONS = [
  { id: "directory", label: "Club accounts" },
  { id: "requests", label: "Requests" },
  { id: "guests", label: "Guest operations" },
  { id: "tools", label: "Club tools" },
] as const;

export const ADMIN_TOOL_SECTIONS = [
  { id: "compliance", label: "Safety & privacy" },
  { id: "support", label: "Messages" },
  { id: "platform", label: "Platform" },
  { id: "team", label: "Staff access" },
  { id: "history", label: "Archive" },
] as const;

export function adminSectionForPanel(workspace: string, panel: string): string | null {
  if (!panel) return null;
  if (workspace === "approvals") {
    if (["admin-review-queue", "admin-dancer-approvals"].includes(panel)) return "profiles";
    if (panel === "admin-reports") return "reports";
    return "media";
  }
  if (workspace === "clubs") {
    if (["admin-club-requests", "admin-club-approval-history", "admin-deal-requests", "admin-club-page-changes"].includes(panel)) return "requests";
    if (panel === "admin-guest-operations") return "guests";
    if (["admin-tap-stickers", "admin-deal-attribution"].includes(panel)) return "tools";
    return "directory";
  }
  if (workspace === "more") {
    if (panel === "admin-compliance") return "compliance";
    if (panel === "admin-staff-access") return "team";
    if (panel === "admin-inbox-archive") return "history";
    if (["admin-dmca", "admin-monitoring", "admin-rankings", "admin-pilot-analytics"].includes(panel)) return "platform";
    return "support";
  }
  return null;
}
