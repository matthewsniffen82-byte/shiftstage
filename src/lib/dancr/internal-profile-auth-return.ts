import { isCurrentBrowserSession, persistRefreshedBrowserAuthSession, readBrowserAuthSession } from "./browser-session";

const PREFIX = "mydancr:internal-follow-return:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIFETIME = 24 * 60 * 60 * 1000;
type FollowReturn = { dancerId: string; clubToken: string; expiresAt: number };

// Only an opaque reference goes through sign-in and email confirmation. The
// private club link stays on this browser, and every roster read rechecks access.
export function createInternalFollowReturn(dancerId: string, clubToken: string) {
  if (!UUID.test(dancerId) || !UUID.test(clubToken)) throw new Error("Open the club's guest roster to follow this dancer.");
  const storage = window.localStorage;
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) readInternalFollowReturn(key.slice(PREFIX.length));
  }
  const state = crypto.randomUUID();
  storage.setItem(PREFIX + state, JSON.stringify({ dancerId, clubToken, expiresAt: Date.now() + LIFETIME }));
  return `/internal/follow-return?state=${state}`;
}

export function readInternalFollowReturn(state: string): FollowReturn | null {
  if (!UUID.test(state)) return null;
  try {
    const record = JSON.parse(window.localStorage.getItem(PREFIX + state) || "null");
    if (record && UUID.test(record.dancerId) && UUID.test(record.clubToken)
      && Number.isFinite(record.expiresAt) && record.expiresAt > Date.now() && record.expiresAt <= Date.now() + LIFETIME) return record;
    window.localStorage.removeItem(PREFIX + state);
  } catch { /* An unavailable browser store cannot authorize a return. */ }
  return null;
}

export function clearInternalFollowReturn(state: string) {
  window.localStorage.removeItem(PREFIX + state);
}

export function internalFollowReturnDestination(record: FollowReturn) {
  return `/internal/club/${encodeURIComponent(record.clubToken)}?profile=${encodeURIComponent(record.dancerId)}`;
}

export async function completeInternalProfileFollow(dancerId: string) {
  const session = readBrowserAuthSession();
  if (!session?.accessToken || session.account?.role !== "customer") throw new Error("Sign in with a guest account to finish following this dancer.");
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` };
  if (session.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
  const response = await fetch("/api/customer/follows", {
    method: "POST", headers, cache: "no-store", signal: AbortSignal.timeout(15000),
    // Resume the requested follow; never toggle an existing follow off.
    body: JSON.stringify({ dancerId, following: true, notificationsEnabled: true }),
  });
  const result = await response.json().catch(() => null);
  if (!isCurrentBrowserSession(session)) throw new Error("Your account changed. Sign in again to finish following.");
  if (!response.ok || !result?.ok || result.following !== true) throw new Error(result?.error || "The follow could not be saved. Try again.");
  persistRefreshedBrowserAuthSession(result.session, session);
}
