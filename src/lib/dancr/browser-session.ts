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
