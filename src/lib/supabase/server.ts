import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";
import type { Database } from "../dancr/types";

export function createServerSupabaseClient() {
  const env = getPublicEnv();

  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
