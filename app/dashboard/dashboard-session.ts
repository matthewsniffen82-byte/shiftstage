import {
  BROWSER_AUTH_SESSION_KEY,
  clearBrowserAuthSession,
  persistBrowserAuthSession,
  persistRefreshedBrowserAuthSession,
  readBrowserAuthSession,
} from "../../src/lib/dancr/browser-session.ts";

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

export const DASHBOARD_SESSION_KEY = BROWSER_AUTH_SESSION_KEY;

export function readSession(): StoredDashboardSession | null {
  return readBrowserAuthSession() as StoredDashboardSession | null;
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
  if (!data?.session?.accessToken) return;
  const current = readSession() || {};
  persistBrowserAuthSession({ ...current, ...data.session });
}

export function persistDashboardSession(session: StoredDashboardSession) {
  return persistBrowserAuthSession(session);
}

export function clearDashboardSession() {
  return clearBrowserAuthSession();
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
  persistRefreshedBrowserAuthSession(session);
}

export function dashboardLoadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to load dashboard.";
  if (/sign in required/i.test(message)) {
    return "Your sign-in expired. Sign in again to continue.";
  }
  return message;
}

export type DashboardJsonRequestOptions = Omit<RequestInit, "headers"> & {
  expectedRole?: string;
  fallbackMessage?: string;
  headers?: Record<string, string>;
};

export class DashboardDataRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DashboardDataRequestError";
    this.status = status;
  }
}

export async function requestDashboardJson(
  path: string,
  options: DashboardJsonRequestOptions = {},
) {
  const {
    expectedRole,
    fallbackMessage = "Unable to update dashboard.",
    headers: requestHeaders,
    ...requestInit
  } = options;
  const authHeaders = currentDashboardAuthHeaders(expectedRole);
  if (!authHeaders) throw new DashboardDataRequestError("Sign in required.", 401);

  const response = await fetch(path, {
    ...requestInit,
    headers: { ...requestHeaders, ...authHeaders },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new DashboardDataRequestError(data?.error || fallbackMessage, response.status);
  }
  persistResponseSession(data);
  return data;
}

export function requestDancerProfileJson(options: DashboardJsonRequestOptions = {}) {
  return requestDashboardJson("/api/dancer/profile", {
    ...options,
    expectedRole: "dancer",
    fallbackMessage: options.fallbackMessage || "Unable to update dancer profile.",
  });
}

export function requestDancerProfileVisibilityJson(options: DashboardJsonRequestOptions = {}) {
  return requestDashboardJson("/api/dancer/profile/visibility", {
    ...options,
    expectedRole: "dancer",
    fallbackMessage: options.fallbackMessage || "Unable to update profile visibility.",
  });
}

export function requestDancerFinanceJson(options: DashboardJsonRequestOptions = {}) {
  return requestDashboardJson("/api/dancer/finance", {
    ...options,
    expectedRole: "dancer",
    fallbackMessage: options.fallbackMessage || "Unable to update payouts.",
  });
}

export function requestDancerVenueVerificationJson(options: DashboardJsonRequestOptions = {}) {
  return requestDashboardJson("/api/dancer/venue-verification", {
    ...options,
    expectedRole: "dancer",
    fallbackMessage: options.fallbackMessage || "Unable to update venue verification.",
  });
}

export function requestVenueDancerVerificationsJson(
  verificationToken = "",
  options: DashboardJsonRequestOptions = {},
) {
  const query = verificationToken ? `?token=${encodeURIComponent(verificationToken)}` : "";
  return requestDashboardJson(`/api/venue/dancer-verifications${query}`, {
    ...options,
    expectedRole: "venue",
    fallbackMessage: options.fallbackMessage || "Unable to update dancer verification.",
  });
}

export function requestDancerShiftsJson(options: DashboardJsonRequestOptions = {}) {
  return requestDashboardJson("/api/dancer/shifts", {
    ...options,
    expectedRole: "dancer",
    fallbackMessage: options.fallbackMessage || "Unable to update dancer shifts.",
  });
}

export function requestDancerShiftCheckInJson(options: DashboardJsonRequestOptions = {}) {
  return requestDashboardJson("/api/dancer/shifts/check-in", {
    ...options,
    expectedRole: "dancer",
    fallbackMessage: options.fallbackMessage || "Unable to update NFC check-in.",
  });
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
