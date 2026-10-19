import type { AdminOperationsCenter } from "../../src/lib/dancr/admin-operations";

const queues = [
  { key: "dancerProfiles", label: "Dancer profiles", section: "Dancer approvals", workspace: "approvals", panel: "admin-dancer-approvals" },
  { key: "photos", label: "Photos", section: "Photo moderation", workspace: "approvals", panel: "admin-photo-review" },
  { key: "videos", label: "Videos", section: "Video moderation", workspace: "approvals", panel: "admin-tv-review" },
  { key: "socialLinks", label: "Social links", section: "Social link reviews", workspace: "approvals", panel: "admin-dancer-approvals" },
  { key: "reports", label: "Reports", section: "Content reports", workspace: "approvals", panel: "admin-reports" },
  { key: "dmca", label: "Copyright cases", section: "Copyright cases", workspace: "more", panel: "admin-dmca" },
  { key: "support", label: "Support", section: "Support inbox", workspace: "more", panel: "admin-support" },
  { key: "venues", label: "Club setup", section: "Venue setup", workspace: "clubs", panel: "admin-club-accounts" },
  { key: "clubRequests", label: "Club requests", section: "Club signup requests", workspace: "approvals", panel: "admin-club-requests" },
] as const;

export function adminAttentionItems(operations: AdminOperationsCenter | null) {
  return queues.map(queue => ({
    ...queue,
    value: !operations || operations.warnings.some(warning => warning.section === queue.section)
      ? null : operations.attention[queue.key],
  }));
}
