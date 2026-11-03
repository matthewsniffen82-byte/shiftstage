import {
  BROWSER_AUTH_SESSION_KEY,
  clearBrowserAuthSession,
  isCurrentBrowserSession,
  persistBrowserAuthSession,
  persistRefreshedBrowserAuthSession,
  readBrowserAuthSession,
  revokeBrowserAuthSession,
} from "../../src/lib/dancr/browser-session.ts";
import { notifyAdminDataChanged } from "./admin-data-events.ts";

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

export function clearAdminSession(expected: StoredAdminSession | null) {
  if (expected?.account?.role !== "admin" || !isCurrentBrowserSession(expected)) return false;
  return clearBrowserAuthSession();
}

export function revokeAdminSession() {
  return revokeBrowserAuthSession();
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

export function persistRefreshedAdminSession(session: unknown, expected?: StoredAdminSession | null) {
  if (!readAdminSession()) return;
  persistRefreshedBrowserAuthSession(session, expected);
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
  timeoutMs?: number;
};

export async function requestAdminJson(
  path: string,
  options: AdminJsonRequestOptions = {},
) {
  const {
    fallbackMessage = "Unable to update admin data.",
    headers: requestHeaders,
    timeoutMs,
    ...requestInit
  } = options;
  const authHeaders = adminAuthHeaders();
  if (!authHeaders) throw new AdminDataRequestError("Admin sign in required.", 401);

  const controller = timeoutMs ? new AbortController() : null;
  const cancel = () => controller?.abort(requestInit.signal?.reason);
  if (requestInit.signal?.aborted) cancel();
  else requestInit.signal?.addEventListener("abort", cancel, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = timeoutMs ? new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new AdminDataRequestError("Loading took too long. Please try again.", 408));
      controller?.abort();
    }, timeoutMs);
  }) : null;
  const request = async () => {
    const response = await fetch(path, {
      ...requestInit,
      ...(controller ? { signal: controller.signal } : {}),
      headers: { ...requestHeaders, ...authHeaders },
    });
    const data = await response.json().catch(() => null);
    if (controller?.signal.aborted || requestInit.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!response.ok || !data?.ok) {
      throw new AdminDataRequestError(data?.error || fallbackMessage, response.status);
    }
    persistRefreshedAdminSession(data.session, {
      accessToken: authHeaders.authorization.slice(7),
      refreshToken: authHeaders["x-dancr-refresh-token"],
    });
    if (path !== "/api/admin/media-workspace") notifyAdminDataChanged(options.method);
    return data;
  };
  try {
    return await (deadline ? Promise.race([request(), deadline]) : request());
  } finally {
    clearTimeout(timeout);
    requestInit.signal?.removeEventListener("abort", cancel);
  }
}

export function isAdminAuthenticationError(error: unknown) {
  return error instanceof AdminDataRequestError && (error.status === 401 || error.status === 403);
}
