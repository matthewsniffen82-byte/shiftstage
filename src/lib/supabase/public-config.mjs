/** Validate public configuration without including its values in errors.
 * @param {string | undefined} url
 * @param {string | undefined} key
 * @param {{allowMissing?: boolean}} options
 */
export function validatePublicSupabaseConfig(url, key, { allowMissing = false } = {}) {
  if (allowMissing && !url && !key) return;
  if (!url || !key) throw new Error("Missing Supabase public environment variables.");
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("Supabase public URL is invalid."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Supabase public URL must be a secure API URL (HTTP is allowed only on localhost).");
  }
  if (key.startsWith("sb_publishable_") && key.length > 15) return;
  let payload;
  try {
    const parts = key.split(".");
    if (parts.length !== 3) throw new Error();
    payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    throw new Error("Supabase browser configuration requires an anon or publishable key.");
  }
  if (payload?.role !== "anon") throw new Error("Supabase browser configuration must never contain a privileged key.");
  if (parsed.hostname.endsWith(".supabase.co") && payload.ref && parsed.hostname.split(".")[0] !== payload.ref) {
    throw new Error("Supabase public URL and anon key belong to different projects.");
  }
}
