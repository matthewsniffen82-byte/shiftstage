import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { deleteOwnDancerPhoto } from "@/src/lib/dancr/dancer";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOCIAL_PLATFORMS = new Set(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);
const MAX_DANCER_PROFILE_PHOTOS = 5;
const APPROVED_PHOTO_BUCKET = "dancer-photos";

type ProfilePhotoStorageValue = {
  storagePath: string;
  publicUrl?: string;
  fromApprovedBucket: boolean;
  isPrimary: boolean;
  sortOrder: number;
};

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    let { data, error } = await loadDancerProfile(client, user.id);

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ ok: false, error: "Dancer profile not found." }, { status: 404 });
    }

    if (await removeSupersededPendingPhotoRows(createAdminSupabaseClient() as any, data.id)) {
      const refreshed = await loadDancerProfile(client, user.id);
      if (refreshed.error) throw refreshed.error;
      data = refreshed.data || data;
    }

    const profileWithPhotos = withPhotoUrls(client, data);
    const pendingPhotoLimit = Math.max(0, MAX_DANCER_PROFILE_PHOTOS - (profileWithPhotos.dancer_photos?.length || 0));
    const pendingPhotoReviews = await loadPendingPhotoReviews(user.id, pendingPhotoLimit);

    return NextResponse.json({
      ok: true,
      profile: {
        ...profileWithPhotos,
        pending_photo_reviews: pendingPhotoReviews,
      },
    });
  } catch (error) {
    return apiError(error, "Unable to load dancer profile.");
  }
}

async function loadPendingPhotoReviews(userId: string, limit = MAX_DANCER_PROFILE_PHOTOS) {
  if (limit <= 0) return [];
  const admin = createAdminSupabaseClient() as any;
  const { data, error } = await admin
    .from("image_moderation_records")
    .select("id, decision, status, upload_context, created_at")
    .eq("user_id", userId)
    .eq("decision", "review")
    .in("status", ["pending", "completed"])
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, MAX_DANCER_PROFILE_PHOTOS));

  if (error) throw error;
  return data || [];
}

function withPhotoUrls(client: any, profile: any) {
  const photos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : [];
  const byPath = new Map<string, any>();
  photos
    .slice()
    .sort((left: any, right: any) => {
      if (Boolean(left.is_primary) !== Boolean(right.is_primary)) return left.is_primary ? -1 : 1;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    })
    .forEach((photo: any) => {
      const key = String(photo.storage_path || photo.id || "");
      if (!key || byPath.has(key)) return;
      byPath.set(key, photo);
    });
  return {
    ...profile,
    dancer_photos: Array.from(byPath.values()).slice(0, MAX_DANCER_PROFILE_PHOTOS).map((photo: any) => ({
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

    const update: Record<string, string | boolean> = {};
    if (typeof body.stageName === "string") update.stage_name = body.stageName.trim();
    if (typeof body.legalName === "string") update.real_name = body.legalName.trim();
    if (typeof body.city === "string") update.city = body.city.trim();
    if (typeof body.bio === "string") update.bio = body.bio.trim();
    if (typeof body.isPublic === "boolean") update.is_public = body.isPublic;

    if (Object.keys(update).length) {
      const { error } = await db.from("dancer_profiles").update(update).eq("id", profile.id);
      if (error) throw error;
    }

    let changedSocialPlatforms: SocialPlatform[] = [];
    if (Array.isArray(body.socials)) {
      const submittedRows = body.socials
        .filter((social: any) => SOCIAL_PLATFORMS.has(social?.platform))
        .map((social: any) => ({
          dancer_id: profile.id,
          platform: social.platform as SocialPlatform,
          handle: String(social.handle || "").trim(),
          url: String(social.url || "").trim(),
          is_active: social.isActive !== false,
        }));
      const rows = submittedRows.filter((social: any) => social.is_active && (social.handle || social.url));

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

      const submittedSocialPlatforms = readSubmittedSocialPlatforms(body, changedSocialPlatforms);
      await submitChangedSocialLinksForReview(db, profile.id, submittedSocialPlatforms);

      const activePlatforms: SocialPlatform[] = rows.map((social: any) => social.platform);
      const submittedPlatforms: SocialPlatform[] = submittedRows.map((social: any) => social.platform);
      const inactivePlatforms = submittedPlatforms.filter((platform: SocialPlatform) => !activePlatforms.includes(platform));
      if (inactivePlatforms.length) {
        const { error } = await db
          .from("social_links")
          .update({ handle: "", url: "", is_active: false })
          .eq("dancer_id", profile.id)
          .in("platform", inactivePlatforms);

        if (error) throw error;
      }
    }

    const deletedPhotoIds = readDeletedPhotoIds(body);
    console.log("PROFILE_SAVE_PAYLOAD", {
      hasMainPhotoUrl: typeof body?.mainPhotoUrl === "string" && Boolean(body.mainPhotoUrl.trim()),
      galleryPhotoUrlCount: Array.isArray(body?.galleryPhotoUrls) ? body.galleryPhotoUrls.length : 0,
      deletedPhotoIds,
      fields: {
        stageName: typeof body.stageName === "string",
        legalName: typeof body.legalName === "string",
        city: typeof body.city === "string",
        bio: typeof body.bio === "string",
        socials: Array.isArray(body.socials),
      },
    });
    const adminDb = createAdminSupabaseClient();
    const deletedPhotoStoragePaths = deletedPhotoIds.length
      ? await loadDeletedPhotoStoragePaths(adminDb, profile.id, user.id, deletedPhotoIds)
      : [];
    if (deletedPhotoIds.length) {
      for (const photoId of deletedPhotoIds) {
        await deleteOwnDancerPhoto(client, user.id, photoId, adminDb);
      }
    }

    await saveProfilePhotoUrls(db, profile.id, body, deletedPhotoIds, deletedPhotoStoragePaths);
    await removeSupersededPendingPhotoRows(adminDb as any, profile.id);

    if (body.submitForReview === true && profile.status !== "approved") {
      await submitProfileForReview(client, db, user.id, profile.id, {
        realName: update.real_name || profile.real_name,
        stageName: update.stage_name || profile.stage_name,
        city: update.city || profile.city,
        status: profile.status,
      });
    } else if (body.submitForReview === true) {
      await submitPendingApprovedContentForReview(db, profile.id);
    }

    const { data: databasePhotosAfterSave, error: databasePhotosAfterSaveError } = await db
      .from("dancer_photos")
      .select("id, is_primary, sort_order, review_status")
      .eq("dancer_id", profile.id)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true });
    if (databasePhotosAfterSaveError) throw databasePhotosAfterSaveError;
    console.log("PROFILE_IMAGES_AFTER_SAVE", databasePhotosAfterSave || []);

    const { data: refreshedProfile, error: refreshedProfileError } = await loadDancerProfile(client, user.id);
    if (refreshedProfileError) throw refreshedProfileError;

    const refreshedProfileWithPhotos = refreshedProfile ? withPhotoUrls(client, refreshedProfile) : null;
    const refreshedPendingLimit = refreshedProfileWithPhotos
      ? Math.max(0, MAX_DANCER_PROFILE_PHOTOS - (refreshedProfileWithPhotos.dancer_photos?.length || 0))
      : MAX_DANCER_PROFILE_PHOTOS;

    return NextResponse.json({
      ok: true,
      profile: refreshedProfileWithPhotos
        ? {
            ...refreshedProfileWithPhotos,
            pending_photo_reviews: await loadPendingPhotoReviews(user.id, refreshedPendingLimit),
          }
        : null,
    });
  } catch (error) {
    return apiError(error, "Unable to update dancer profile.");
  }
}

function loadDancerProfile(client: any, userId: string) {
  return client
    .from("dancer_profiles")
    .select("*, social_links(*), dancer_photos(*)")
    .eq("user_id", userId)
    .maybeSingle();
}

async function submitChangedSocialLinksForReview(db: any, dancerId: string, platforms: SocialPlatform[]) {
  const uniquePlatforms = [...new Set(platforms)];
  if (!uniquePlatforms.length) return 0;

  const { data: socials, error } = await db
    .from("social_links")
    .select("id, platform")
    .eq("dancer_id", dancerId)
    .eq("is_active", true)
    .in("platform", uniquePlatforms);

  if (error) throw error;
  if (!socials?.length) return 0;

  const adminDb = createAdminSupabaseClient() as any;
  const reviewTypes = socials.map((social: any) => `social_link:${social.id}`);
  const { data: existingReviews, error: existingReviewsError } = await adminDb
    .from("approval_reviews")
    .select("review_type")
    .eq("dancer_id", dancerId)
    .eq("status", "pending")
    .in("review_type", reviewTypes);

  if (existingReviewsError) throw existingReviewsError;
  const existingTypes = new Set((existingReviews || []).map((review: any) => review.review_type));
  const rows = socials
    .filter((social: any) => !existingTypes.has(`social_link:${social.id}`))
    .map((social: any) => ({
      dancer_id: dancerId,
      reviewer_id: null,
      review_type: `social_link:${social.id}`,
      status: "pending",
      notes: "Submitted by dancer.",
      reviewed_at: null,
    }));

  if (!rows.length) return 0;
  const { error: insertError } = await adminDb.from("approval_reviews").insert(
    rows,
  );

  if (insertError) throw insertError;
  return rows.length;
}

function readSubmittedSocialPlatforms(body: any, fallbackPlatforms: SocialPlatform[]) {
  const rawPlatforms = Array.isArray(body?.submittedSocialPlatforms) ? body.submittedSocialPlatforms : [];
  const platforms = rawPlatforms.filter((platform: any) => SOCIAL_PLATFORMS.has(platform)) as SocialPlatform[];
  return platforms.length ? platforms : fallbackPlatforms;
}

async function submitPendingApprovedContentForReview(db: any, dancerId: string) {
  const { data: photos, error } = await db
    .from("dancer_photos")
    .select("id")
    .eq("dancer_id", dancerId)
    .eq("review_status", "pending");

  if (error) throw error;

  const reviewTypes = (photos || []).map((photo: any) => `photo:${photo.id}`);
  if (!reviewTypes.length) return;

  const adminDb = createAdminSupabaseClient() as any;
  const { data: existingReviews, error: existingReviewsError } = await adminDb
    .from("approval_reviews")
    .select("review_type")
    .eq("dancer_id", dancerId)
    .eq("status", "pending")
    .in("review_type", reviewTypes);

  if (existingReviewsError) throw existingReviewsError;
  const existingTypes = new Set((existingReviews || []).map((review: any) => review.review_type));
  const reviewRows = (photos || [])
    .filter((photo: any) => !existingTypes.has(`photo:${photo.id}`))
    .map((photo: any) => ({
    dancer_id: dancerId,
    reviewer_id: null,
    review_type: `photo:${photo.id}`,
    status: "pending",
    notes: "Submitted by dancer.",
    reviewed_at: null,
  }));

  if (!reviewRows.length) return;

  const { error: insertError } = await adminDb.from("approval_reviews").insert(reviewRows);
  if (insertError) throw insertError;
}

async function markApprovedProfileContentPending(db: any, dancerId: string) {
  const { error } = await db
    .from("dancer_profiles")
    .update({ photo_review_status: "pending" })
    .eq("id", dancerId);

  if (error) throw error;
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

async function loadDeletedPhotoStoragePaths(db: any, dancerId: string, userId: string, deletedPhotoIds: string[]) {
  const deletedIds = deletedPhotoIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (!deletedIds.length) return [];

  const paths = new Set<string>();

  const { data: deletedPhotos, error: deletedPhotosError } = await db
    .from("dancer_photos")
    .select("id, storage_path")
    .eq("dancer_id", dancerId)
    .in("id", deletedIds);
  if (deletedPhotosError) throw deletedPhotosError;
  for (const photo of deletedPhotos || []) {
    const path = normalizeStorageKey(photo?.storage_path);
    if (path) paths.add(path);
  }

  const { data: moderationRows, error: moderationRowsError } = await db
    .from("image_moderation_records")
    .select("id, temporary_storage_path, final_storage_path")
    .eq("user_id", userId)
    .in("id", deletedIds);
  if (moderationRowsError) throw moderationRowsError;
  for (const row of moderationRows || []) {
    const temporaryPath = normalizeStorageKey(row?.temporary_storage_path);
    const finalPath = normalizeStorageKey(row?.final_storage_path);
    if (temporaryPath) paths.add(temporaryPath);
    if (finalPath) paths.add(finalPath);
  }

  return Array.from(paths);
}

async function saveProfilePhotoUrls(
  db: any,
  dancerId: string,
  body: any,
  deletedPhotoIds: string[] = [],
  deletedPhotoStoragePaths: string[] = [],
) {
  const rawPhotoUrls = readProfilePhotoUrls(body);
  const deletedPaths = new Set(deletedPhotoStoragePaths.map(normalizeStorageKey).filter(Boolean));
  const photoUrls = rawPhotoUrls.filter((photo) => {
    const storagePath = normalizeStorageKey(photo.storagePath);
    const publicUrlPath = normalizeStorageKey(photo.publicUrl);
    return !deletedPaths.has(storagePath) && !deletedPaths.has(publicUrlPath);
  });
  console.log("PROFILE_SAVE_PHOTO_URL_FILTER", {
    submittedCount: rawPhotoUrls.length,
    keptCount: photoUrls.length,
    deletedPhotoIds,
    deletedPhotoPathCount: deletedPaths.size,
  });
  if (!photoUrls.length) return;
  const deletedIds = new Set(deletedPhotoIds);

  const storagePaths = photoUrls.map((photo) => photo.storagePath);
  const { data: existing, error: existingError } = await db
    .from("dancer_photos")
    .select("id, storage_path")
    .eq("dancer_id", dancerId)
    .in("storage_path", storagePaths);

  if (existingError) throw existingError;

  const existingByPath = new Map<string, { id: string }>(
    (existing || [])
      .filter((photo: any) => !deletedIds.has(String(photo.id || "")))
      .map((photo: any) => [photo.storage_path, { id: photo.id }]),
  );

  await removeDuplicatePublicUrlPhotoRows(db, dancerId, photoUrls, existingByPath);

  const newRows = photoUrls
    .filter((photo) => !photo.fromApprovedBucket && !existingByPath.has(photo.storagePath))
    .map((photo) => ({
      dancer_id: dancerId,
      storage_path: photo.storagePath,
      is_primary: photo.isPrimary,
      sort_order: photo.sortOrder,
      review_status: "pending",
    }));

  if (photoUrls.some((photo) => photo.isPrimary)) {
    const { error } = await db.from("dancer_photos").update({ is_primary: false }).eq("dancer_id", dancerId);
    if (error) throw error;
  }

  const existingUpdates = photoUrls.flatMap((photo) => {
    const existingPhoto = existingByPath.get(photo.storagePath);
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

async function removeSupersededPendingPhotoRows(db: any, dancerId: string) {
  const { data, error } = await db
    .from("dancer_photos")
    .select("id, is_primary, sort_order, review_status, created_at")
    .eq("dancer_id", dancerId);

  if (error) throw error;
  const rows = data || [];
  const approvedSlots = new Set(
    rows
      .filter((photo: any) => photo.review_status === "approved")
      .map((photo: any) => photoSlotKey(photo)),
  );
  const pendingIds = rows
    .filter((photo: any) => photo.review_status === "pending" && approvedSlots.has(photoSlotKey(photo)))
    .map((photo: any) => photo.id)
    .filter(Boolean);

  if (!pendingIds.length) return false;

  const { error: deleteError } = await db
    .from("dancer_photos")
    .delete()
    .eq("dancer_id", dancerId)
    .in("id", pendingIds);

  if (deleteError) throw deleteError;
  return true;
}

function photoSlotKey(photo: any) {
  return `${photo?.is_primary ? "main" : "gallery"}:${Number(photo?.sort_order || 0)}`;
}

function readProfilePhotoUrls(body: any) {
  const urls: ProfilePhotoStorageValue[] = [];
  const seen = new Set<string>();
  const mainPhotoUrl = readPhotoStorageValue(body?.mainPhotoUrl);

  if (mainPhotoUrl) {
    urls.push({ ...mainPhotoUrl, isPrimary: true, sortOrder: 0 });
    seen.add(mainPhotoUrl.storagePath);
  }

  const galleryUrls = Array.isArray(body?.galleryPhotoUrls) ? body.galleryPhotoUrls : [];
  for (const value of galleryUrls) {
    const url = readPhotoStorageValue(value);
    if (!url || seen.has(url.storagePath)) continue;

    urls.push({ ...url, isPrimary: !mainPhotoUrl && urls.length === 0, sortOrder: urls.length + 1 });
    seen.add(url.storagePath);
  }

  return urls.slice(0, MAX_DANCER_PROFILE_PHOTOS);
}

function readDeletedPhotoIds(body: any): string[] {
  if (!Array.isArray(body?.deletedPhotoIds)) return [];
  return [...new Set<string>(
    body.deletedPhotoIds
      .map((id: any) => String(id || "").trim())
      .filter(Boolean),
  )];
}

function readPhotoStorageValue(value: unknown): Omit<ProfilePhotoStorageValue, "isPrimary" | "sortOrder"> | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const approvedStoragePath = approvedBucketPathFromPublicUrl(url);
    return {
      storagePath: approvedStoragePath || url.toString(),
      publicUrl: url.toString(),
      fromApprovedBucket: Boolean(approvedStoragePath),
    };
  } catch {
    return {
      storagePath: text.replace(/^\/+/, ""),
      fromApprovedBucket: false,
    };
  }
}

function normalizeStorageKey(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    const approvedStoragePath = approvedBucketPathFromPublicUrl(url);
    return (approvedStoragePath || url.toString()).replace(/^\/+/, "");
  } catch {
    return text.replace(/^\/+/, "");
  }
}

function approvedBucketPathFromPublicUrl(url: URL) {
  const marker = `/storage/v1/object/public/${APPROVED_PHOTO_BUCKET}/`;
  const index = url.pathname.indexOf(marker);
  if (index === -1) return "";
  return decodeURIComponent(url.pathname.slice(index + marker.length));
}

async function removeDuplicatePublicUrlPhotoRows(
  db: any,
  dancerId: string,
  photoUrls: Array<{ storagePath: string; publicUrl?: string; fromApprovedBucket: boolean }>,
  existingByPath: Map<string, { id: string }>,
) {
  const duplicatePublicUrls = photoUrls
    .filter((photo) => photo.fromApprovedBucket && photo.publicUrl && existingByPath.has(photo.storagePath))
    .map((photo) => photo.publicUrl as string);

  if (!duplicatePublicUrls.length) return;

  const { error } = await db
    .from("dancer_photos")
    .delete()
    .eq("dancer_id", dancerId)
    .eq("review_status", "pending")
    .in("storage_path", duplicatePublicUrls);

  if (error) throw error;
}
