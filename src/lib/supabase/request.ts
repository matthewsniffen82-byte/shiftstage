import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

export type RequestSupabaseContext = {
  client: SupabaseClient;
  user: User;
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
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  if (refreshToken) {
    const { error: sessionError } = await client.auth.setSession({
      access_token: token,
      refresh_token: refreshToken,
    });

    if (sessionError) throw new Error("Sign in required.");
  }

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Sign in required.");

  return { client, user: data.user };
}
