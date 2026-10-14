import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getDancerProfile } from "@/src/lib/dancr/public";
import { loadPublicDancerContent } from "@/src/lib/dancr/public-dancer-content";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const client = createAdminSupabaseClient();
    const { data: owner, error } = await client.from("dancer_profiles").select("id, slug").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    const profile = owner?.slug ? await getDancerProfile(client, owner.slug, false) : null;
    // Draft identity and approved media already belong to the authenticated editor.
    // Live activity/venue content must only come from this account's public profile.
    const content = profile && profile.id === owner?.id ? { profile, ...await loadPublicDancerContent(client, profile) } : null;
    return NextResponse.json({ ok: true, content, session }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load profile preview.");
  }
}
