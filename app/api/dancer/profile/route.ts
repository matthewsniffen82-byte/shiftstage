import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOCIAL_PLATFORMS = new Set(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);
const MAX_DANCER_PROFILE_PHOTOS = 5;

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

    return NextResponse.json({ ok: true, profile: withPhotoUrls(client, data) });
  } catch (error) {
    return apiError(error, "Unable to load dancer profile.");
  }
}

function withPhotoUrls(client: any, profile: any) {
  const photos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : [];
  return {
    ...profile,
    dancer_photos: photos.map((photo: any) => ({
      ...photo,
      imageUrl: getPhotoUrl(client, photo.storage_path),
    })),
  };
}

function getPhotoUrl(client: any, storagePath: unknown) {
  if (typeof storagePath !== "string" || !storagePath.trim()) return "";
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  return client.storage.from("dancer-photos").getPublicUrl(storagePath).data.publicUrl;
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const db = client as any;

    const { data: profile, error: profileError } = await db
      .from("dancer_profiles")
      .select("id, real_name, stage_name, city, status")
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

    let changedSocialPlatforms: SocialPlatform[] = [];
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
        const { data: existingSocials, error: existingSocialsError } = await db
          .from("social_links")
          .select("platform, handle, url, is_active")
          .eq("dancer_id", profile.id)
          .in("platform", rows.map((social: any) => social.platform));

        if (existingSocialsError) throw existingSocialsError;

        const existingByPlatform = new Map<string, any>(
          (existingSocials || []).map((social: any) => [social.platform, social]),
        );
        changedSocialPlatforms = rows
          .filter((social: any) => {
            const existing = existingByPlatform.get(social.platform);
            return !existing ||
              String(existing.handle || "") !== social.handle ||
              String(existing.url || "") !== social.url ||
              existing.is_active === false;
          })
          .map((social: any) => social.platform);
      }

      if (rows.length) {
        const { error } = await db.from("social_links").upsert(rows, { onConflict: "dancer_id,platform" });
        if (error) throw error;
      }

      if (body.submitForReview === true && changedSocialPlatforms.length) {
        await submitChangedSocialLinksForReview(db, profile.id, changedSocialPlatforms);
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

    if (body.submitForReview === true && profile.status !== "approved") {
      await submitProfileForReview(client, db, user.id, profile.id, {
        realName: update.real_name || profile.real_name,
        stageName: update.stage_name || profile.stage_name,
        city: update.city || profile.city,
        status: profile.status,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update dancer profile.");
  }
}

async function submitChangedSocialLinksForReview(db: any, dancerId: string, platforms: SocialPlatform[]) {
  const uniquePlatforms = [...new Set(platforms)];
  if (!uniquePlatforms.length) return;

  const { data: socials, error } = await db
    .from("social_links")
    .select("id, platform")
    .eq("dancer_id", dancerId)
    .in("platform", uniquePlatforms);

  if (error) throw error;
  if (!socials?.length) return;

  const adminDb = createAdminSupabaseClient() as any;
  const { error: insertError } = await adminDb.from("approval_reviews").insert(
    socials.map((social: any) => ({
      dancer_id: dancerId,
      reviewer_id: null,
      review_type: `social_link:${social.id}`,
      status: "pending",
      notes: "Submitted by dancer.",
      reviewed_at: null,
    })),
  );

  if (insertError) throw insertError;
}

async function submitProfileForReview(
  client: any,
  db: any,
  userId: string,
  dancerId: string,
  profile: { realName?: string; stageName?: string; city?: string; status?: string },
) {
  if (!profile.realName?.trim() || !profile.stageName?.trim() || !profile.city?.trim()) {
    throw new Error("Save legal name, stage name, and city before submitting for review.");
  }

  const { data: photos, error: photosError } = await db
    .from("dancer_photos")
    .select("id")
    .eq("dancer_id", dancerId)
    .limit(1);

  if (photosError) throw photosError;
  if (!photos?.length) throw new Error("Upload profile photos before submitting for review.");

  const { data: documents, error: documentsError } = await client.storage
    .from("verification-documents")
    .list(`${userId}/verification`, { limit: 3 });

  if (documentsError) throw documentsError;
  if ((documents || []).filter((document: any) => Boolean(document?.name)).length < 3) {
    throw new Error("Upload ID, selfie, and proof that you dance before submitting for review.");
  }

  const { error } = await db
    .from("dancer_profiles")
    .update({
      status: "pending_review",
      verification_status: "pending",
      photo_review_status: "pending",
    })
    .eq("id", dancerId);

  if (error) throw error;

  if (profile.status === "rejected") {
    const adminDb = createAdminSupabaseClient() as any;
    const { error: photoError } = await db
      .from("dancer_photos")
      .update({ review_status: "pending" })
      .eq("dancer_id", dancerId)
      .eq("review_status", "rejected");

    if (photoError) throw photoError;
    await reopenRejectedReviewsForResubmission(adminDb, dancerId);
  }
}

async function reopenRejectedReviewsForResubmission(db: any, dancerId: string) {
  const { data: reviews, error } = await db
    .from("approval_reviews")
    .select("review_type, status, created_at, reviewed_at")
    .eq("dancer_id", dancerId);

  if (error) throw error;

  const latestByType = new Map<string, any>();
  for (const review of reviews || []) {
    const type = review.review_type;
    const previous = latestByType.get(type);
    const reviewTime = Date.parse(review.reviewed_at || review.created_at || "") || 0;
    const previousTime = previous ? Date.parse(previous.reviewed_at || previous.created_at || "") || 0 : -1;
    if (!previous || reviewTime >= previousTime) latestByType.set(type, review);
  }

  const rows = Array.from(latestByType.entries())
    .filter(([, review]) => review.status === "rejected")
    .map(([reviewType]) => ({
      dancer_id: dancerId,
      reviewer_id: null,
      review_type: reviewType,
      status: "pending",
      notes: "Resubmitted by dancer.",
      reviewed_at: null,
    }));

  if (!rows.length) return;
  const { error: insertError } = await db.from("approval_reviews").insert(rows);
  if (insertError) throw insertError;
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

  return urls.slice(0, MAX_DANCER_PROFILE_PHOTOS);
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
