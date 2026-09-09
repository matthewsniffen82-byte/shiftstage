import "server-only";

/**
 * Catch configuration mistakes before constructing a privileged client.
 * This is not signature verification or user authorization; Supabase still
 * verifies the credential. Opaque secret keys cannot be mapped to a project here.
 */
export function validateServerSupabaseConfig(url: string, key: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    throw new Error("Supabase server URL is invalid.");
  }
  if (!key || key.trim() !== key) {
    throw new Error("Supabase server configuration requires a service-role or secret key.");
  }
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return;

  let payload: { role?: unknown; ref?: unknown } | null;
  try {
    const parts = key.split(".");
    if (parts.length !== 3 || parts.some(part => !part)) throw new Error();
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Supabase server configuration requires a service-role or secret key.");
  }
  if (payload?.role !== "service_role") {
    throw new Error("Supabase server configuration requires a service-role or secret key.");
  }
  if (parsed.hostname.endsWith(".supabase.co") && payload.ref
    && parsed.hostname.split(".")[0] !== payload.ref) {
    throw new Error("Supabase server URL and service-role key belong to different projects.");
  }
}
