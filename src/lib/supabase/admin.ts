import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv } from "../env";
import type { Database } from "../dancr/types";

export function createAdminSupabaseClient() {
  const env = getPublicEnv();
  const serviceRoleKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient<Database>(env.supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
