const destinations = {
  compliance_case: { workspace: "more", panel: "admin-compliance" },
  club_application: { workspace: "clubs", panel: "admin-club-requests" },
  deal_request: { workspace: "clubs", panel: "admin-deal-requests" },
  page_changes: { workspace: "clubs", panel: "admin-club-page-changes" },
  content_report: { workspace: "approvals", panel: "admin-reports" },
  copyright_case: { workspace: "more", panel: "admin-dmca" },
  media_approval: { workspace: "approvals", panel: "admin-media-workbench" },
} as const;

export function adminReviewEmailDestination(kind: unknown) {
  return typeof kind === "string" && Object.hasOwn(destinations, kind)
    ? destinations[kind as keyof typeof destinations] : null;
}

export function adminReviewEmailPath(kind: string) {
  return adminReviewEmailDestination(kind) ? `/admin?alert=${encodeURIComponent(kind)}` : "/admin";
}
