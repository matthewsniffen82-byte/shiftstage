import {
  BROWSER_AUTH_SESSION_KEY,
  clearBrowserAuthSession,
  persistBrowserAuthSession,
  persistRefreshedBrowserAuthSession,
  readBrowserAuthSession,
} from "../../src/lib/dancr/browser-session.ts";

export type AdminSessionAccount = {
  role?: string;
  [key: string]: unknown;
};

export type StoredAdminSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  account?: AdminSessionAccount | null;
  [key: string]: unknown;
};

export const ADMIN_SESSION_KEY = BROWSER_AUTH_SESSION_KEY;

export function persistAdminSession(session: StoredAdminSession, account: AdminSessionAccount | null | undefined) {
  persistBrowserAuthSession({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    account,
  });
}

export function clearAdminSession() {
  clearBrowserAuthSession();
}

export function readAdminSession(): StoredAdminSession | null {
  const session = readBrowserAuthSession();
  if (session?.account?.role !== "admin") return null;
  return session as StoredAdminSession;
}

export function readAdminAccessToken() {
  const session = readAdminSession();
  return typeof session?.accessToken === "string" ? session.accessToken : "";
}

export function adminAuthHeaders(): Record<string, string> | null {
  const session = readAdminSession();
  if (!session?.accessToken) return null;
  return {
    authorization: `Bearer ${session.accessToken}`,
    ...(session.refreshToken ? { "x-dancr-refresh-token": String(session.refreshToken) } : {}),
  };
}

export function persistRefreshedAdminSession(session: unknown) {
  if (!readAdminSession()) return;
  persistRefreshedBrowserAuthSession(session);
}

export class AdminDataRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminDataRequestError";
    this.status = status;
  }
}

export type AdminJsonRequestOptions = Omit<RequestInit, "headers"> & {
  fallbackMessage?: string;
  headers?: Record<string, string>;
};

export async function requestAdminJson(
  path: string,
  options: AdminJsonRequestOptions = {},
) {
  const {
    fallbackMessage = "Unable to update admin data.",
    headers: requestHeaders,
    ...requestInit
  } = options;
  const authHeaders = adminAuthHeaders();
  if (!authHeaders) throw new AdminDataRequestError("Admin sign in required.", 401);

  const response = await fetch(path, {
    ...requestInit,
    headers: { ...requestHeaders, ...authHeaders },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new AdminDataRequestError(data?.error || fallbackMessage, response.status);
  }
  persistRefreshedAdminSession(data.session);
  return data;
}

export function isAdminAuthenticationError(error: unknown) {
  return error instanceof AdminDataRequestError && (error.status === 401 || error.status === 403);
}
