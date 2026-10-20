import type { VipDraft } from "./vip-dashboard";

export const VIP_DRAFT_PREFIX = "mydancr:vip-draft:v1:";
export type VipRetry = { id: string; fingerprint: string };
export type VipWorkspace = { drafts: Record<string, VipDraft>; retries: Record<string, VipRetry> };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const ttl = 24 * 60 * 60 * 1000;

export function readVipWorkspace(storage: DraftStorage, accountId: string, now = Date.now()): VipWorkspace {
  const empty = { drafts: {}, retries: {} };
  try {
    const value = JSON.parse(storage.getItem(VIP_DRAFT_PREFIX + accountId) || "null");
    if (!value || value.accountId !== accountId || !Number.isFinite(value.savedAt) || now - value.savedAt > ttl || value.savedAt > now) {
      storage.removeItem(VIP_DRAFT_PREFIX + accountId); return empty;
    }
    const drafts: Record<string, VipDraft> = {}, retries: Record<string, VipRetry> = {};
    for (const [venueId, entry] of Object.entries(value.drafts || {}).slice(0, 50)) {
      if (!/^[\w-]{1,128}$/.test(venueId) || ["__proto__", "constructor", "prototype"].includes(venueId) || !entry || typeof entry !== "object") continue;
      const draft = entry as VipDraft;
      if (!Array.isArray(draft.selected) || draft.selected.length > 10 || !draft.selected.every(id => typeof id === "string" && /^[\w-]{1,128}$/.test(id))
        || typeof draft.date !== "string" || !/^(\d{4}-\d{2}-\d{2})?$/.test(draft.date)
        || typeof draft.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$|^$/.test(draft.time)) continue;
      drafts[venueId] = { selected: [...new Set(draft.selected)], date: draft.date, time: draft.time };
      const retry = value.retries?.[venueId];
      if (typeof retry?.id === "string" && /^[0-9a-f-]{36}$/i.test(retry.id) && retry.fingerprint === vipDraftFingerprint(venueId, drafts[venueId])) {
        retries[venueId] = { id: retry.id, fingerprint: retry.fingerprint };
      }
    }
    return { drafts, retries };
  } catch { return empty; }
}

export function saveVipWorkspace(storage: DraftStorage, accountId: string, workspace: VipWorkspace) {
  try {
    const drafts = Object.fromEntries(Object.entries(workspace.drafts).filter(([, draft]) => draft.selected.length || draft.date || draft.time));
    if (!Object.keys(drafts).length) storage.removeItem(VIP_DRAFT_PREFIX + accountId);
    else storage.setItem(VIP_DRAFT_PREFIX + accountId, JSON.stringify({ accountId, savedAt: Date.now(), drafts, retries: workspace.retries }));
    return true;
  } catch {
    // Planning can still work in memory when storage is unavailable.
    return false;
  }
}

export function addVipDraftDancer(draft: VipDraft, dancerId: string): VipDraft {
  if (draft.selected.includes(dancerId)) return draft;
  if (draft.selected.length >= 10) throw new Error("Your visit already has 10 dancers. Open My dancers to remove one before adding another.");
  return { ...draft, selected: [...draft.selected, dancerId] };
}

export function queueVipProfileDancer(storage: DraftStorage, accountId: string, venueId: string, dancerId: string) {
  // Read at click time so additions made in other profile tabs are retained.
  try { storage.getItem(VIP_DRAFT_PREFIX + accountId); }
  catch { throw new Error("Unable to save your selection. Open My dancers and add them there."); }
  const workspace = readVipWorkspace(storage, accountId);
  const current = workspace.drafts[venueId] || { selected: [], date: "", time: "" };
  const next = addVipDraftDancer(current, dancerId);
  workspace.drafts[venueId] = next;
  if (next !== current) delete workspace.retries[venueId];
  if (!saveVipWorkspace(storage, accountId, workspace)) {
    throw new Error("Unable to save your selection. Open My dancers and add them there.");
  }
  return next;
}

export function vipDraftFingerprint(venueId: string, draft: VipDraft) {
  return JSON.stringify({ venueId, localStart: `${draft.date}T${draft.time}`, dancerIds: [...draft.selected].sort() });
}
