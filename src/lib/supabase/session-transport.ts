import { getPublicEnv } from "../env.ts";
import { boundedSupabaseFetch } from "./bounded-fetch.ts";
import { PublicApiError } from "../api-error-policy.ts";

const tokenPattern = /^[A-Za-z0-9._~-]+$/;
export const SESSION_RESPONSE_HEADERS = {
  access: "x-dancr-session-access", refresh: "x-dancr-session-refresh", expires: "x-dancr-session-expires",
};

/** JWT decoding schedules refresh only. Route handlers still verify the user. */
export async function refreshExpiringRequestSession(request: Request, fetcher = boundedSupabaseFetch) {
  const access = (request.headers.get("authorization") || "").match(/^Bearer (.+)$/i)?.[1];
  const refresh = request.headers.get("x-dancr-refresh-token");
  if (!access || !refresh || access.length > 8192 || refresh.length > 4096 || !tokenPattern.test(access) || !tokenPattern.test(refresh)) return null;
  let claims;
  try { claims = JSON.parse(atob(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  if (!Number.isFinite(claims.exp) || typeof claims.sub !== "string" || claims.exp > Date.now() / 1000 + 120) return null;
  const env = getPublicEnv();
  const response = await fetcher(`${env.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: env.supabaseAnonKey, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if ([408, 429].includes(response.status) || response.status >= 500) throw new PublicApiError("UNAVAILABLE", "We couldn't refresh your session right now. Please try again.", 503);
    throw new PublicApiError("AUTH_REQUIRED", "Your sign-in expired. Sign in again to continue.", 401);
  }
  if (data?.user?.id !== claims.sub || typeof data.access_token !== "string" || typeof data.refresh_token !== "string"
    || !tokenPattern.test(data.access_token) || !tokenPattern.test(data.refresh_token)
    || data.access_token.length > 8192 || data.refresh_token.length > 4096 || !Number.isFinite(data.expires_in) || data.expires_in <= 120) {
    throw new PublicApiError("UNAVAILABLE", "Your refreshed session could not be confirmed. Please sign in again.", 503);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Math.floor(Date.now() / 1000) + data.expires_in };
}
