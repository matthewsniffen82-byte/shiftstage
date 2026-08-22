export type DashboardSessionAccount = {
  displayName?: string | null;
  email?: string | null;
  role?: string;
  accountState?: string;
};

export type StoredDashboardSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  account?: DashboardSessionAccount | null;
  [key: string]: unknown;
};

export const DASHBOARD_SESSION_KEY = "dancrAuthSessionV1";

export function readSession(): StoredDashboardSession | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DASHBOARD_SESSION_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed as StoredDashboardSession : null;
  } catch {
    return null;
  }
}

export function storedSessionAccount(session: StoredDashboardSession | null): DashboardSessionAccount | null {
  const account = session?.account;
  if (!account || typeof account !== "object") return null;

  const displayName = typeof account.displayName === "string" ? account.displayName.trim() : "";
  const email = typeof account.email === "string" ? account.email : null;
  const role = typeof account.role === "string" ? account.role : undefined;
  const accountState = typeof account.accountState === "string" ? account.accountState : undefined;
  if (!displayName && !email && !role && !accountState) return null;

  return {
    displayName: displayName || null,
    email,
    role,
    accountState,
  };
}

export function storedSessionIsFresh(session: StoredDashboardSession | null) {
  const expiresAt = Number(session?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1000) + 120;
}

export function persistResponseSession(data: { session?: StoredDashboardSession } | null | undefined) {
  if (typeof window === "undefined" || !data?.session?.accessToken) return;
  const current = readSession() || {};
  window.localStorage.setItem(DASHBOARD_SESSION_KEY, JSON.stringify({ ...current, ...data.session }));
}

export function dashboardAuthHeaders(session: StoredDashboardSession | null): Record<string, string> | null {
  if (!session?.accessToken) return null;
  return {
    authorization: `Bearer ${session.accessToken}`,
    ...(session.refreshToken ? { "x-dancr-refresh-token": String(session.refreshToken) } : {}),
  };
}

export function readDashboardAccessToken(expectedRole?: string) {
  const session = readSession();
  if (expectedRole && session?.account?.role !== expectedRole) return "";
  return typeof session?.accessToken === "string" ? session.accessToken : "";
}

export function currentDashboardAuthHeaders(expectedRole?: string): Record<string, string> | null {
  const session = readSession();
  if (expectedRole && session?.account?.role !== expectedRole) return null;
  return dashboardAuthHeaders(session);
}

export function persistRefreshedDashboardSession(session: unknown) {
  if (typeof window === "undefined" || !session || typeof session !== "object") return;
  try {
    const current = readSession() || {};
    const next = session as StoredDashboardSession;
    window.localStorage.setItem(DASHBOARD_SESSION_KEY, JSON.stringify({
      ...current,
      accessToken: typeof next.accessToken === "string" ? next.accessToken : current.accessToken,
      refreshToken: typeof next.refreshToken === "string" ? next.refreshToken : current.refreshToken,
      expiresAt: typeof next.expiresAt === "number" ? next.expiresAt : current.expiresAt,
    }));
  } catch {
    // The completed request remains valid if browser storage is unavailable.
  }
}

export function dashboardLoadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to load dashboard.";
  if (/sign in required/i.test(message)) {
    return "Your sign-in expired. Sign in again to continue.";
  }
  return message;
}

export async function readJson(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers, cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load dashboard.");
  persistResponseSession(data);
  return data;
}

export async function readOptionalJson<T>(path: string, headers: Record<string, string>, fallback: T): Promise<T | any> {
  try {
    return await readJson(path, headers);
  } catch (error) {
    console.warn("Dashboard panel did not load", { path, message: error instanceof Error ? error.message : "Request failed" });
    return fallback;
  }
}
