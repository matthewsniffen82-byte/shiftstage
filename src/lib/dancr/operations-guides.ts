export const OPERATIONS_SUPPORT_EMAIL = "support@mydancr.com";

export const GUIDE_ROLES = [
  { id: "club-admin", title: "Club Admin", description: "Prepare the club, manage team access and check QR signs and stickers.", pages: 5 },
  { id: "manager", title: "Managers & talent", description: "Run the shift, manage requests, admit guests and hand over.", pages: 6 },
  { id: "dancer", title: "Dancers", description: "Set up your profile, upload media and manage your working status.", pages: 6 },
  { id: "content-approval", title: "Content approval", description: "Inspect uploads, record decisions and verify publication.", pages: 4 },
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
