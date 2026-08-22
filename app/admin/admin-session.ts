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

export function readAdminAccessToken() {
  if (typeof window === "undefined") return "";
  try {
    const session = JSON.parse(window.localStorage.getItem(ADMIN_SESSION_KEY) || "null");
    if (!session || typeof session !== "object" || session.account?.role !== "admin") return "";
    return typeof session.accessToken === "string" ? session.accessToken : "";
  } catch {
    return "";
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
