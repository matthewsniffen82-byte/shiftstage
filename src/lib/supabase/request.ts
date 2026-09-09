import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getPublicEnv } from "../env.ts";
import { PublicApiError } from "../api-error-policy.ts";
import { boundedSupabaseFetch } from "./bounded-fetch.ts";

const MAX_ACCESS_TOKEN_LENGTH = 8_192;
const MAX_REFRESH_TOKEN_LENGTH = 4_096;
const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;

// These requirements are supplied by route code, never by request payloads or JWT metadata.
export type RequestAccountAccess = { role: "customer" | "dancer" | "venue" | "admin" } | { active: true };

export type RequestSupabaseContext = {
  client: SupabaseClient;
  user: User;
  session?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
};

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;

  return readBoundedAuthToken(header.slice(7), MAX_ACCESS_TOKEN_LENGTH);
}

export function getRefreshToken(request: Request) {
  return readBoundedAuthToken(
    request.headers.get("x-dancr-refresh-token"),
    MAX_REFRESH_TOKEN_LENGTH,
  );
}

export async function createRequestSupabaseContext(request: Request, access?: RequestAccountAccess): Promise<RequestSupabaseContext> {
  const token = getBearerToken(request);
  if (!token) throw new Error("Sign in required.");
  const refreshToken = getRefreshToken(request);

  const env = getPublicEnv();
  const authOptions = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  };

  if (refreshToken) {
    const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      global: { fetch: boundedSupabaseFetch },
      auth: authOptions,
    });

    const { data: sessionData, error: sessionError } = await client.auth.setSession({
      access_token: token,
      refresh_token: refreshToken,
    });

    if (sessionError || !sessionData.session) throw requestAuthenticationError(sessionError);

    const { data, error } = await client.auth.getUser(sessionData.session.access_token);
    if (error || !data.user) throw requestAuthenticationError(error);
    await requireRequestAccountAccess(client, data.user.id, access);

    return {
      client,
      user: data.user,
      session: {
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
        expiresAt: sessionData.session.expires_at,
      },
    };
  }

  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      fetch: boundedSupabaseFetch,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: authOptions,
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw requestAuthenticationError(error);
  await requireRequestAccountAccess(client, data.user.id, access);

  return { client, user: data.user };
}

async function requireRequestAccountAccess(client: SupabaseClient, userId: string, access?: RequestAccountAccess) {
  if (!access) return;
  const { data, error } = await client.from("app_users")
    .select("id, role, account_state").eq("id", userId).maybeSingle();
  if (error) throw new PublicApiError("UNAVAILABLE", "We couldn't verify your account access. Please try again.", 503);
  if (!data || data.id !== userId || data.account_state !== "active" || ("role" in access && data.role !== access.role)) {
    throw new PublicApiError("FORBIDDEN", "This account cannot access this feature.", 403);
  }
}

function requestAuthenticationError(error: { status?: number; name?: string } | null) {
  if (error && (error.status === 0 || error.status === 408 || error.status === 429 || Number(error.status) >= 500 || error.name === "AuthRetryableFetchError")) {
    return new PublicApiError("UNAVAILABLE", "We couldn't verify your session right now. Please try again.", 503);
  }
  return new Error("Sign in required.");
}

function readBoundedAuthToken(value: string | null, maxLength: number) {
  const token = value?.trim() || "";
  if (!token || token.length > maxLength || !AUTH_TOKEN_PATTERN.test(token)) return null;
  return token;
}
