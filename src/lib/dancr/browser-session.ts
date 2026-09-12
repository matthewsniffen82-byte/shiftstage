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

// Orders asynchronous sign-in results; this is not an authorization check.
export function captureBrowserAuthSessionGuard(): () => boolean {
  try {
    const expected = window.localStorage.getItem(BROWSER_AUTH_SESSION_KEY);
    return () => {
      try { return window.localStorage.getItem(BROWSER_AUTH_SESSION_KEY) === expected; }
      catch { return false; }
    };
  } catch {
    return () => false;
  }
}

export function readBrowserAuthSession(): BrowserAuthSession | null {
  if (typeof window === "undefined") return null;
  clearRetiredBrowserAccountCaches();

  try {
    return parseBrowserAuthSession(window.localStorage.getItem(BROWSER_AUTH_SESSION_KEY));
  } catch {
    return null;
  }
}

function parseBrowserAuthSession(raw: string | null): BrowserAuthSession | null {
  const parsed = JSON.parse(raw || "null");
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as BrowserAuthSession
    : null;
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
    const previousPushAccount = window.localStorage.getItem("mydancr:push-account");
    if (previousPushAccount && previousPushAccount !== next.account?.id) void clearCustomerPushDevice();
    window.localStorage.setItem(BROWSER_AUTH_SESSION_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export type BrowserSessionRequest = { accessToken?: string; refreshToken?: string };

export function isCurrentBrowserSession(expected?: BrowserSessionRequest | null) {
  const current = readBrowserAuthSession();
  return Boolean(expected?.accessToken && current?.accessToken === expected.accessToken
    && (current.refreshToken || "") === (expected.refreshToken || ""));
}

export function persistRefreshedBrowserAuthSession(session: unknown, expected?: BrowserSessionRequest | null) {
  if (typeof window === "undefined" || !session || typeof session !== "object" || Array.isArray(session)) return false;

  const next = session as BrowserAuthSession;
  if (typeof next.accessToken !== "string" || !next.accessToken) return false;

  try {
    const snapshot = window.localStorage.getItem(BROWSER_AUTH_SESSION_KEY);
    const current = parseBrowserAuthSession(snapshot);
    if (!expected?.accessToken || !current || current.accessToken !== expected.accessToken
      || (current.refreshToken || "") !== (expected.refreshToken || "")) return false;
    const serialized = JSON.stringify({
      ...current,
      accessToken: next.accessToken,
      refreshToken: typeof next.refreshToken === "string" ? next.refreshToken : current.refreshToken,
      expiresAt: typeof next.expiresAt === "number" ? next.expiresAt : current.expiresAt,
    });
    const previousPushAccount = window.localStorage.getItem("mydancr:push-account");
    // Keep account metadata from the same snapshot as the checked credentials.
    // Compare again before writing; these checks are not a lock across tabs.
    if (window.localStorage.getItem(BROWSER_AUTH_SESSION_KEY) !== snapshot) return false;
    window.localStorage.setItem(BROWSER_AUTH_SESSION_KEY, serialized);
    // Preserve successful-save cleanup; a rejected refresh must not clear the
    // push identity belonging to a newer sign-in.
    if (previousPushAccount && previousPushAccount !== current.account?.id) void clearCustomerPushDevice();
    return true;
  } catch {
    return false;
  }
}

export function clearBrowserAuthSession() {
  if (typeof window === "undefined") return false;

  try {
    clearRetiredBrowserAccountCaches();
    void clearCustomerPushDevice();
    window.localStorage.removeItem(BROWSER_AUTH_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

function clearRetiredBrowserAccountCaches() {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index) || "";
      if (key.startsWith("dancrAccountEmail:") || key.startsWith("mydancr:admin-content-reviews:")) {
        window.localStorage.removeItem(key);
      }
    }
  } catch { /* Storage denial must not prevent account cleanup. */ }
}

async function clearCustomerPushDevice() {
  try {
    window.localStorage.removeItem("mydancr:push-account");
    if (!("serviceWorker" in window.navigator)) return;
    const registration = await window.navigator.serviceWorker.getRegistration("/push/onesignal/");
    if (!registration?.scope.endsWith("/push/onesignal/")) return;
    const subscription = await registration?.pushManager.getSubscription();
    if (!window.localStorage.getItem("mydancr:push-account")) await subscription?.unsubscribe();
  } catch { /* Best-effort native cleanup also works when the push SDK is not loaded. */ }
}

export async function revokeBrowserAuthSession() {
  const session = readBrowserAuthSession();
  clearBrowserAuthSession();

  const accessToken = typeof session?.accessToken === "string" ? session.accessToken : "";
  if (!accessToken) return true;

  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
  };
  if (typeof session?.refreshToken === "string" && session.refreshToken) {
    headers["x-dancr-refresh-token"] = session.refreshToken;
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch("/api/auth", {
      method: "DELETE",
      headers,
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
