import { readBrowserAuthSession } from "../../src/lib/dancr/browser-session.ts";

export type ClubPageDraft = {
  name: string; address: string; city: string; state: string; phone: string;
  website: string; timezone: string; opensAt: string; closesAt: string; transportEnabled: string;
};
export type ClubDealDraft = {
  venueId: string; dealId: string; requestId: string; dealTitle: string;
  dealDescription: string; dealTerms: string; sortOrder: string; isActive: boolean;
};
type Drafts = { "club-page": ClubPageDraft; "club-deal": ClubDealDraft; "club-deal-selection": { venueId: string; dealId: string } };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export const ADMIN_DRAFT_PREFIX = "mydancr:admin-form:v1:";
const fields = {
  "club-page": ["name", "address", "city", "state", "phone", "website", "timezone", "opensAt", "closesAt", "transportEnabled"],
  "club-deal": ["venueId", "dealId", "requestId", "dealTitle", "dealDescription", "dealTerms", "sortOrder", "isActive"],
  "club-deal-selection": ["venueId", "dealId"],
} as const;

function storageKey(accountId: string, kind: keyof Drafts, scope: string) {
  return ADMIN_DRAFT_PREFIX + [accountId, kind, scope].map(encodeURIComponent).join(":");
}

function parseDraft<K extends keyof Drafts>(kind: K, value: unknown): Drafts[K] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const clean: Record<string, string | boolean> = {};
  for (const field of fields[kind]) {
    const item = source[field];
    if (field === "isActive") { if (typeof item !== "boolean") return null; }
    else if (typeof item !== "string" || item.length > 4000) return null;
    clean[field] = item as string | boolean;
  }
  return clean as Drafts[K];
}

export function readAdminDraft<K extends keyof Drafts>(storage: DraftStorage, accountId: string, kind: K, scope: string, now = Date.now()): Drafts[K] | null {
  if (!accountId || !scope) return null;
  const key = storageKey(accountId, kind, scope);
  try {
    const raw = storage.getItem(key);
    const saved = raw && raw.length <= 50000 ? JSON.parse(raw) : null;
    if (!saved || saved.accountId !== accountId || saved.kind !== kind || saved.scope !== scope
      || !Number.isFinite(saved.savedAt) || saved.savedAt > now) {
      storage.removeItem(key); return null;
    }
    return parseDraft(kind, saved.value);
  } catch { return null; }
}

export function writeAdminDraft<K extends keyof Drafts>(storage: DraftStorage, accountId: string, kind: K, scope: string, value: Drafts[K] | null, now = Date.now()) {
  if (!accountId || !scope) return false;
  try {
    const key = storageKey(accountId, kind, scope);
    if (value === null) storage.removeItem(key);
    else {
      const clean = parseDraft(kind, value);
      if (!clean) return false;
      storage.setItem(key, JSON.stringify({ accountId, kind, scope, savedAt: now, value: clean }));
    }
    return true;
  } catch { return false; }
}

function browserDraftContext() {
  if (typeof window === "undefined") return null;
  try {
    const session = readBrowserAuthSession();
    const id = session?.account?.id;
    return session?.account?.role === "admin" && typeof id === "string" && id && session.accessToken
      ? { storage: window.sessionStorage, accountId: id } : null;
  } catch { return null; }
}

export function loadAdminFormDraft<K extends keyof Drafts>(kind: K, scope: string) {
  const context = browserDraftContext();
  return context ? readAdminDraft(context.storage, context.accountId, kind, scope) : null;
}

export function saveAdminFormDraft<K extends keyof Drafts>(kind: K, scope: string, value: Drafts[K] | null) {
  const context = browserDraftContext();
  return context ? writeAdminDraft(context.storage, context.accountId, kind, scope, value) : false;
}

export function clearAdminFormDrafts() {
  if (typeof window === "undefined") return;
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(ADMIN_DRAFT_PREFIX)) storage.removeItem(key);
    }
  } catch { /* Sign-out must still succeed when browser storage is unavailable. */ }
}
