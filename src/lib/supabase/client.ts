import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";
import { boundedSupabaseFetch } from "./bounded-fetch";

let uploadClient: SupabaseClient | undefined;

export function createBrowserSupabaseClient() {
  if (uploadClient) return uploadClient;
  const env = getPublicEnv();

  // Signed uploads use their own scoped token; application auth is managed
  // through browser-session, not a second Supabase localStorage session.
  uploadClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: boundedSupabaseFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return uploadClient;
}
