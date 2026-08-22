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

export const ADMIN_SESSION_KEY = "dancrAuthSessionV1";

export function persistAdminSession(session: StoredAdminSession, account: AdminSessionAccount | null | undefined) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ADMIN_SESSION_KEY,
    JSON.stringify({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      account,
    }),
  );
}

export function clearAdminSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ADMIN_SESSION_KEY);
}

export function readAdminSession(): StoredAdminSession | null {
  if (typeof window === "undefined") return null;
  try {
    const session = JSON.parse(window.localStorage.getItem(ADMIN_SESSION_KEY) || "null");
    if (!session || typeof session !== "object" || session.account?.role !== "admin") return null;
    return session as StoredAdminSession;
  } catch {
    return null;
  }
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
  if (typeof window === "undefined" || !session || typeof session !== "object") return;
  try {
    const current = readAdminSession();
    if (!current) return;
    const next = session as StoredAdminSession;
    window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
      ...current,
      accessToken: typeof next.accessToken === "string" ? next.accessToken : current.accessToken,
      refreshToken: typeof next.refreshToken === "string" ? next.refreshToken : current.refreshToken,
      expiresAt: typeof next.expiresAt === "number" ? next.expiresAt : current.expiresAt,
    }));
  } catch {
    // The completed request remains valid if browser storage is unavailable.
  }
}

export class AdminDataRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminDataRequestError";
    this.status = status;
  }
}

export async function readAdminJson(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new AdminDataRequestError(data?.error || "Unable to load admin data.", response.status);
  }
  return data;
}

export function isAdminAuthenticationError(error: unknown) {
  return error instanceof AdminDataRequestError && (error.status === 401 || error.status === 403);
}
