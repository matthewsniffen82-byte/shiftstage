import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveDancerProfileAlias(client: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await client.from("dancer_profile_slug_aliases")
    .select("dancer_profiles!inner(slug)").eq("slug", slug).maybeSingle();
  // Allow the app to deploy before the additive alias migration.
  if (error && ["42P01", "PGRST205"].includes(error.code)) return null;
  if (error) throw error;
  const profile: unknown = data?.dancer_profiles;
  const row: unknown = Array.isArray(profile) ? profile[0] : profile;
  const canonical = row && typeof row === "object" && "slug" in row ? row.slug : null;
  return typeof canonical === "string" && canonical !== slug ? canonical : null;
}
