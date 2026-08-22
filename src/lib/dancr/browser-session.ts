export type BrowserSessionRole = "customer" | "dancer" | "venue" | "admin";

export type BrowserAuthSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  account?: {
    role?: BrowserSessionRole;
    displayName?: string | null;
    email?: string | null;
    accountState?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

export const BROWSER_AUTH_SESSION_KEY = "dancrAuthSessionV1";

export function readBrowserAuthSession(): BrowserAuthSession | null {
  if (typeof window === "undefined") return null;

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(BROWSER_AUTH_SESSION_KEY) || "null",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as BrowserAuthSession
      : null;
  } catch {
    return null;
  }
}

export function readBrowserAccessToken(expectedRole?: BrowserSessionRole) {
  const session = readBrowserAuthSession();
  if (expectedRole && session?.account?.role !== expectedRole) return "";
  return typeof session?.accessToken === "string" ? session.accessToken : "";
}

export function persistBrowserAuthSession(session: unknown) {
  if (
    typeof window === "undefined" ||
    !session ||
    typeof session !== "object" ||
    Array.isArray(session)
  ) {
    return false;
  }

  const next = session as BrowserAuthSession;
  if (typeof next.accessToken !== "string" || !next.accessToken) return false;

  try {
    window.localStorage.setItem(BROWSER_AUTH_SESSION_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function persistRefreshedBrowserAuthSession(session: unknown) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;

  const next = session as BrowserAuthSession;
  if (typeof next.accessToken !== "string" || !next.accessToken) return false;
  const current = readBrowserAuthSession() || {};

  return persistBrowserAuthSession({
    ...current,
    accessToken: next.accessToken,
    refreshToken: typeof next.refreshToken === "string"
      ? next.refreshToken
      : current.refreshToken,
    expiresAt: typeof next.expiresAt === "number"
      ? next.expiresAt
      : current.expiresAt,
  });
}

export function clearBrowserAuthSession() {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.removeItem(BROWSER_AUTH_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}
