import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOCIAL_PLATFORMS = new Set(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const { data, error } = await (client as any)
      .from("dancer_profiles")
      .select("*, social_links(*), dancer_photos(*)")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, profile: data });
  } catch (error) {
    return apiError(error, "Unable to load dancer profile.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const db = client as any;

    const { data: profile, error: profileError } = await db
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    const update: Record<string, string> = {};
    if (typeof body.stageName === "string") update.stage_name = body.stageName.trim();
    if (typeof body.legalName === "string") update.real_name = body.legalName.trim();
    if (typeof body.city === "string") update.city = body.city.trim();
    if (typeof body.bio === "string") update.bio = body.bio.trim();

    if (Object.keys(update).length) {
      const { error } = await db.from("dancer_profiles").update(update).eq("id", profile.id);
      if (error) throw error;
    }

    if (Array.isArray(body.socials)) {
      const rows = body.socials
        .filter((social: any) => SOCIAL_PLATFORMS.has(social?.platform))
        .map((social: any) => ({
          dancer_id: profile.id,
          platform: social.platform as SocialPlatform,
          handle: String(social.handle || "").trim(),
          url: String(social.url || "").trim(),
          is_active: social.isActive !== false,
        }))
        .filter((social: any) => social.handle || social.url);

      if (rows.length) {
        const { error } = await db.from("social_links").upsert(rows, { onConflict: "dancer_id,platform" });
        if (error) throw error;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update dancer profile.");
  }
}
