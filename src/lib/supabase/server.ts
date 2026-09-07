import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";
import { boundedSupabaseFetch } from "./bounded-fetch";

export function createServerSupabaseClient() {
  const env = getPublicEnv();

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: boundedSupabaseFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
