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

      const activePlatforms = rows.map((social: any) => social.platform);
      const inactivePlatforms = Array.from(SOCIAL_PLATFORMS).filter((platform) => !activePlatforms.includes(platform));
      if (inactivePlatforms.length) {
        const { error } = await db
          .from("social_links")
          .update({ is_active: false })
          .eq("dancer_id", profile.id)
          .in("platform", inactivePlatforms);

        if (error) throw error;
      }
    }

    await saveProfilePhotoUrls(db, profile.id, body);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update dancer profile.");
  }
}

async function saveProfilePhotoUrls(db: any, dancerId: string, body: any) {
  const photoUrls = readProfilePhotoUrls(body);
  if (!photoUrls.length) return;

  const { data: existing, error: existingError } = await db
    .from("dancer_photos")
    .select("id, storage_path")
    .eq("dancer_id", dancerId)
    .in("storage_path", photoUrls.map((photo) => photo.url));

  if (existingError) throw existingError;

  const existingByPath = new Map<string, { id: string }>(
    (existing || []).map((photo: any) => [photo.storage_path, { id: photo.id }]),
  );
  const newRows = photoUrls
    .filter((photo) => !existingByPath.has(photo.url))
    .map((photo) => ({
      dancer_id: dancerId,
      storage_path: photo.url,
      is_primary: photo.isPrimary,
      sort_order: photo.sortOrder,
      review_status: "pending",
    }));

  if (photoUrls.some((photo) => photo.isPrimary)) {
    const { error } = await db.from("dancer_photos").update({ is_primary: false }).eq("dancer_id", dancerId);
    if (error) throw error;
  }

  const existingUpdates = photoUrls.flatMap((photo) => {
    const existingPhoto = existingByPath.get(photo.url);
    return existingPhoto ? [{ ...photo, id: existingPhoto.id }] : [];
  });

  await Promise.all(
    existingUpdates.map((photo) =>
      db
        .from("dancer_photos")
        .update({ is_primary: photo.isPrimary, sort_order: photo.sortOrder })
        .eq("id", photo.id),
    ),
  ).then((results) => {
    const failed = results.find((result: any) => result.error);
    if (failed) throw failed.error;
  });

  if (newRows.length) {
    const { error } = await db.from("dancer_photos").insert(newRows);
    if (error) throw error;

    const { error: profileError } = await db
      .from("dancer_profiles")
      .update({ photo_review_status: "pending" })
      .eq("id", dancerId);

    if (profileError) throw profileError;
  }
}

function readProfilePhotoUrls(body: any) {
  const urls: Array<{ url: string; isPrimary: boolean; sortOrder: number }> = [];
  const seen = new Set<string>();
  const mainPhotoUrl = readUrl(body?.mainPhotoUrl);

  if (mainPhotoUrl) {
    urls.push({ url: mainPhotoUrl, isPrimary: true, sortOrder: 0 });
    seen.add(mainPhotoUrl);
  }

  const galleryUrls = Array.isArray(body?.galleryPhotoUrls) ? body.galleryPhotoUrls : [];
  for (const value of galleryUrls) {
    const url = readUrl(value);
    if (!url || seen.has(url)) continue;

    urls.push({ url, isPrimary: !mainPhotoUrl && urls.length === 0, sortOrder: urls.length + 1 });
    seen.add(url);
  }

  return urls;
}

function readUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}
