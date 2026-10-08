import type { VipDancer, VipDashboardView } from "./vip-types";

export const VIP_DESTINATIONS: Array<{ id: VipDashboardView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "plan", label: "Plan a visit" },
  { id: "requests", label: "Requests" },
  { id: "account", label: "Account" },
];
export type VipDraft = { selected: string[]; date: string; time: string; notes: string };
export const emptyVipDraft = (): VipDraft => ({ selected: [], date: "", time: "", notes: "" });

export function vipDestination(hash: string): VipDashboardView {
  const id = hash.replace(/^#vip-/, "");
  return VIP_DESTINATIONS.find(destination => destination.id === id)?.id || "overview";
}

export function filterVipDancers(dancers: VipDancer[], search: string, filter: "all" | "working" | "selected", selected: string[]) {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return dancers.filter(dancer => (filter !== "working" || dancer.working_now)
    && (filter !== "selected" || selected.includes(dancer.id))
    && terms.every(term => dancer.stage_name.toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number(b.working_now) - Number(a.working_now) || a.stage_name.localeCompare(b.stage_name, "en", { sensitivity: "base", numeric: true }));
}

export function reconcileVipDraft(draft: VipDraft, dancers: VipDancer[]) {
  const ids = new Set(dancers.map(dancer => dancer.id));
  return { ...draft, selected: draft.selected.filter(id => ids.has(id)) };
}
