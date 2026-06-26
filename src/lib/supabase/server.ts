import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

export function createServerSupabaseClient() {
  const env = getPublicEnv();

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
