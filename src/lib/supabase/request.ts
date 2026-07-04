import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

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

  const token = header.slice(7).trim();
  return token || null;
}

export function getRefreshToken(request: Request) {
  const token = request.headers.get("x-dancr-refresh-token")?.trim();
  return token || null;
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
