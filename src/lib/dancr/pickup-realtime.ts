import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

// A dedicated short-lived client avoids changing the existing upload client's auth.
export async function subscribePickup(requestId: string, accessToken: string, onChange: () => void, onState: (connected: boolean) => void) {
  const env = getPublicEnv();
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await client.realtime.setAuth(accessToken);
  const channel = client.channel(`pickup:${requestId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "pickup_messages", filter: `pickup_request_id=eq.${requestId}` }, onChange)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pickup_requests", filter: `id=eq.${requestId}` }, onChange)
    .subscribe(status => { onState(status === "SUBSCRIBED"); if (status === "SUBSCRIBED") onChange(); });
  return {
    setToken: (token: string) => client.realtime.setAuth(token),
    close: async () => { await client.removeChannel(channel); client.realtime.disconnect(); },
  };
}
