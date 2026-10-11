import type { VipDancer, VipDashboardView, VipRequest } from "./vip-types";

export const VIP_DESTINATIONS: Array<{ id: VipDashboardView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "plan", label: "My dancers" },
  { id: "requests", label: "Requests" },
  { id: "account", label: "Account" },
];
export type VipDraft = { selected: string[]; date: string; time: string };
export type VipDancerFilter = "all" | "working" | "selected" | "favorites" | "following" | "previous";
export const emptyVipDraft = (): VipDraft => ({ selected: [], date: "", time: "" });

export function vipRequestDraft(request: VipRequest, timeZone = request.timezone): VipDraft {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(request.starts_at));
  const part = (key: string) => parts.find(item => item.type === key)?.value || "";
  return { selected: request.dancers.map(dancer => dancer.id), date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export function vipDestination(hash: string): VipDashboardView {
  const id = hash.replace(/^#vip-/, "");
  if (id === "dancers") return "plan";
  return VIP_DESTINATIONS.find(destination => destination.id === id)?.id || "overview";
}

export function filterVipDancers(dancers: VipDancer[], search: string, filter: VipDancerFilter, selected: string[]) {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return dancers.filter(dancer => (filter !== "working" || dancer.working_now)
    && (filter !== "all" || dancer.canRequest !== false || dancer.previouslyRequested)
    && (filter !== "selected" || selected.includes(dancer.id))
    && (filter !== "favorites" || dancer.favorite)
    && (filter !== "following" || dancer.following)
    && (filter !== "previous" || dancer.previouslyRequested)
    && terms.every(term => dancer.stage_name.toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number(b.working_now) - Number(a.working_now) || a.stage_name.localeCompare(b.stage_name, "en", { sensitivity: "base", numeric: true }));
}

export function reconcileVipDraft(draft: VipDraft, dancers: VipDancer[]) {
  const ids = new Set(dancers.filter(dancer => dancer.canRequest !== false).map(dancer => dancer.id));
  return { ...draft, selected: draft.selected.filter(id => ids.has(id)) };
}
