export type StaffRole = "owner" | "reviewer" | "support" | "billing" | "compliance";
export type StaffScope = StaffRole | "workspace";
export type Workspace = "home" | "approvals" | "people" | "clubs" | "money" | "more";
export const STAFF_WORKSPACES: Record<StaffRole, Workspace[]> = {
  owner: ["home", "approvals", "people", "clubs", "money", "more"],
  reviewer: ["approvals"], support: ["more"], billing: ["money"], compliance: ["more"],
};
export function staffRole(value: unknown): StaffRole | null {
  return typeof value === "string" && Object.hasOwn(STAFF_WORKSPACES, value) ? value as StaffRole : null;
}
export function permitsStaffScope(role: StaffRole | null, scope: StaffScope) {
  return Boolean(role && (role === "owner" || scope === "workspace" || role === scope));
}
