import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";
import { getServerEnv } from "../server-env";
import { boundedSupabaseFetch } from "./bounded-fetch";

export function createAdminSupabaseClient() {
  const env = getPublicEnv();
  const serviceRoleKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(env.supabaseUrl, serviceRoleKey, {
    global: { fetch: boundedSupabaseFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
