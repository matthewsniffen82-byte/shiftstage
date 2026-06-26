import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

export function createBrowserSupabaseClient() {
  const env = getPublicEnv();

  return createClient(env.supabaseUrl, env.supabaseAnonKey);
}
