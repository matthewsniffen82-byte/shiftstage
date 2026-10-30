import type { AdminOperationsCenter } from "../../src/lib/dancr/admin-operations";

const queues = [
  { key: "dancerProfiles", label: "Dancer profiles", section: "Dancer approvals", workspace: "approvals", panel: "admin-dancer-approvals" },
  { key: "photos", label: "Photos", section: "Photo moderation", workspace: "approvals", panel: "admin-photo-review" },
  { key: "videos", label: "Videos", section: "Video moderation", workspace: "approvals", panel: "admin-tv-review" },
  { key: "socialLinks", label: "Social links", section: "Social link reviews", workspace: "approvals", panel: "admin-dancer-approvals" },
  { key: "reports", label: "Reports", section: "Content reports", workspace: "approvals", panel: "admin-reports" },
  { key: "dmca", label: "Copyright cases", section: "Copyright cases", workspace: "more", panel: "admin-dmca" },
  { key: "support", label: "Messages & support", section: "Support inbox", workspace: "more", panel: "admin-support" },
  { key: "venues", label: "Club setup", section: "Club setup", workspace: "clubs", panel: "admin-club-accounts" },
  { key: "clubRequests", label: "Club applications", section: "Club signup requests", workspace: "clubs", panel: "admin-club-requests" },
  { key: "dealRequests", label: "Club deal requests", section: "Club deal requests", workspace: "clubs", panel: "admin-deal-requests" },
  { key: "clubPageChanges", label: "Club page changes", section: "Club page changes", workspace: "clubs", panel: "admin-club-page-changes" },
] as const;

export function adminAttentionItems(operations: AdminOperationsCenter | null) {
  return queues.map(queue => ({
    ...queue,
    value: !operations || operations.warnings.some(warning => warning.section === queue.section)
      ? null : operations.attention[queue.key] ?? null,
  }));
}
