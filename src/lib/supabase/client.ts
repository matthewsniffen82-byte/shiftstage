import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";
import type { Database } from "../dancr/types";

export function createBrowserSupabaseClient() {
  const env = getPublicEnv();

  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
}
