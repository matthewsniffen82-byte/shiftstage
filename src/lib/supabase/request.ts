import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getPublicEnv } from "../env.ts";

const MAX_ACCESS_TOKEN_LENGTH = 8_192;
const MAX_REFRESH_TOKEN_LENGTH = 4_096;
const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;

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

export async function createRequestSupabaseContext(request: Request): Promise<RequestSupabaseContext> {
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
      auth: authOptions,
    });

    const { data: sessionData, error: sessionError } = await client.auth.setSession({
      access_token: token,
      refresh_token: refreshToken,
    });

    if (sessionError || !sessionData.session) throw new Error("Sign in required.");

    const { data, error } = await client.auth.getUser(sessionData.session.access_token);
    if (error || !data.user) throw new Error("Sign in required.");

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
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: authOptions,
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Sign in required.");

  return { client, user: data.user };
}

function readBoundedAuthToken(value: string | null, maxLength: number) {
  const token = value?.trim() || "";
  if (!token || token.length > maxLength || !AUTH_TOKEN_PATTERN.test(token)) return null;
  return token;
}
