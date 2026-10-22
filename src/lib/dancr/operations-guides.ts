export const OPERATIONS_SUPPORT_EMAIL = "support@mydancr.com";

export const GUIDE_ROLES = [
  { id: "club-admin", title: "Club Admin", description: "Manage club setup, team access, publication, offers, QR signs, website grids and operating reviews.", pages: 16 },
  { id: "manager", title: "Managers & talent", description: "Run the roster, table requests, guest list, VIP visits, rides, contacts and shift handover.", pages: 13 },
  { id: "dancer", title: "Dancers", description: "Complete setup, manage photos and videos, check in, choose visibility and review results.", pages: 15 },
  { id: "content-approval", title: "Content approval", description: "Review media, approve releases, verify internal and external destinations, and handle corrections.", pages: 13 },
] as const;

export type GuideRole = typeof GUIDE_ROLES[number]["id"];
export type GuideDocument = { id: string; role: GuideRole | "master"; kind: "guide" | "cheat-sheet" | "manual"; file: string };
export const GUIDE_DOCUMENTS: readonly GuideDocument[] = [
  { id: "club-admin-guide", role: "club-admin", kind: "guide", file: "MyDancr_Club_Admin_Onboarding_Guide.pdf" },
  { id: "club-admin-cheat-sheet", role: "club-admin", kind: "cheat-sheet", file: "MyDancr_Club_Admin_Cheat_Sheet.pdf" },
  { id: "manager-guide", role: "manager", kind: "guide", file: "MyDancr_Manager_Talent_Onboarding_Guide.pdf" },
  { id: "manager-cheat-sheet", role: "manager", kind: "cheat-sheet", file: "MyDancr_Manager_Talent_Cheat_Sheet.pdf" },
  { id: "dancer-guide", role: "dancer", kind: "guide", file: "MyDancr_Dancer_Onboarding_Guide.pdf" },
  { id: "dancer-cheat-sheet", role: "dancer", kind: "cheat-sheet", file: "MyDancr_Dancer_Cheat_Sheet.pdf" },
  { id: "content-approval-guide", role: "content-approval", kind: "guide", file: "MyDancr_Content_Approval_Onboarding_Guide.pdf" },
  { id: "content-approval-cheat-sheet", role: "content-approval", kind: "cheat-sheet", file: "MyDancr_Content_Approval_Cheat_Sheet.pdf" },
  { id: "operations-manual", role: "master", kind: "manual", file: "MyDancr_Operations_Manual.pdf" },
  { id: "operations-packet", role: "master", kind: "manual", file: "MyDancr_Complete_Operations_Packet.pdf" },
];

export type GuideAccess = { role: string; accountState: string; venueRole?: string | null };

// Call only with an account and current membership read on the server.
export function canDownloadGuide(access: GuideAccess, document: GuideDocument) {
  if (access.accountState !== "active") return false;
  if (access.role === "admin") return true;
  if (access.role === "dancer") return document.role === "dancer";
  return access.role === "venue" && ["owner", "manager"].includes(access.venueRole || "");
}

// A document ID is an allowlist lookup, never a filesystem path.
export function findGuideDocument(id: string) {
  return GUIDE_DOCUMENTS.find(document => document.id === id) || null;
}
