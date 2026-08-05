import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MODERATION_TEMP_BUCKET,
  moderateImageWithOpenAI,
} from "./image-moderation";
import { validateAndPrepareDancrImage } from "./image-validation";
import { evaluateDancrImageModeration } from "./moderation-policy";
import {
  removeResponsiveImage,
  responsivePublicImage,
  uploadResponsiveImage,
} from "./responsive-image";
import { removeArchivedOriginalMedia } from "./media-watermark";
import {
  getVenueDealForAccount,
  getVenueDealRevenueMetrics,
} from "./deals";
import { isCurrentLocationVerification } from "./geofence";
import type {
  ClubDeal,
  VenueDashboardAnalytics,
  VenueDashboardDancer,
  VenueOwnerProfile,
} from "./types";

type DancrClient = SupabaseClient;

const QR_BUCKET = "venue-qr-codes";
const COVER_BUCKET = "venue-cover-images";

export async function ensureVenueForAccount(
  client: DancrClient,
  input: { userId: string; name: string; city: string },
): Promise<VenueOwnerProfile> {
  const existing = await getVenueForAccount(client, input.userId);
  if (existing) return existing;

  const baseSlug = slugify(input.name) || `venue-${input.userId.slice(0, 8)}`;
  await assertNewVenueAvailable(client, input.name);
  const { data, error } = await client
    .from("venues")
    .insert({
      owner_user_id: input.userId,
      name: requiredText(input.name, "Venue name", 2, 120),
      slug: baseSlug,
      city: requiredText(input.city, "City", 2, 100),
      timezone: "America/Los_Angeles",
      is_active: true,
    })
    .select(VENUE_OWNER_COLUMNS)
    .single();

  if (error) throw error;
  return toVenueOwnerProfile(client, data);
}

export async function assertNewVenueAvailable(client: DancrClient, name: string) {
  const baseSlug = slugify(requiredText(name, "Venue name", 2, 120));
  const { data: listedVenue, error: listedVenueError } = await client
    .from("venues")
    .select("id, name, owner_user_id")
    .eq("slug", baseSlug)
    .maybeSingle();
  if (listedVenueError) throw listedVenueError;
  if (listedVenue) {
    throw new Error(
      listedVenue.owner_user_id
        ? `${listedVenue.name} is already managed. Contact MyDancr support if venue access needs to change.`
        : `${listedVenue.name} is already listed. Use the private venue access code during venue sign up.`,
    );
  }
}

export async function getVenueForAccount(client: DancrClient, userId: string): Promise<VenueOwnerProfile | null> {
  const { data, error } = await client
    .from("venues")
    .select(VENUE_OWNER_COLUMNS)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? toVenueOwnerProfile(client, data) : null;
}

export async function updateVenueForAccount(
  client: DancrClient,
  userId: string,
  input: {
    name?: string;
    city?: string;
    state?: string | null;
    address?: string | null;
    phone?: string | null;
    website?: string | null;
    qrCodeLabel?: string | null;
  },
): Promise<VenueOwnerProfile> {
  const venue = await requireVenueForAccount(client, userId);
  const update: Record<string, string | null> = {};
  if (input.name !== undefined) update.name = requiredText(input.name, "Venue name", 2, 120);
  if (input.city !== undefined) update.city = requiredText(input.city, "City", 2, 100);
  if (input.state !== undefined) update.state = optionalText(input.state, "State", 50);
  if (input.address !== undefined) update.address = optionalText(input.address, "Address", 240);
  if (input.phone !== undefined) update.phone = optionalText(input.phone, "Phone", 40);
  if (input.website !== undefined) update.website = optionalUrl(input.website);
  if (input.qrCodeLabel !== undefined) update.qr_code_label = optionalText(input.qrCodeLabel, "QR label", 100);

  if (!Object.keys(update).length) return venue;

  const { data, error } = await client
    .from("venues")
    .update(update)
    .eq("id", venue.id)
    .eq("owner_user_id", userId)
    .select(VENUE_OWNER_COLUMNS)
    .single();

  if (error) throw error;
  return toVenueOwnerProfile(client, data);
}

export async function uploadVenueQrCode(
  client: DancrClient,
  userId: string,
  file: Blob,
  label?: string | null,
): Promise<VenueOwnerProfile> {
  const venue = await requireVenueForAccount(client, userId);
  const image = await validateAndPrepareDancrImage(file);
  if (image.width < 180 || image.height < 180) {
    throw new Error("QR image must be at least 180 by 180 pixels.");
  }
  const ratio = image.width / image.height;
  if (ratio < 0.8 || ratio > 1.25) {
    throw new Error("QR image must be approximately square.");
  }

  const storagePath = `${venue.id}/${image.storageFileName}`;
  const { error: uploadError } = await client.storage
    .from(QR_BUCKET)
    .upload(storagePath, image.buffer, {
      contentType: image.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data, error } = await client
    .from("venues")
    .update({
      qr_code_storage_path: storagePath,
      qr_code_label: optionalText(label, "QR label", 100),
      qr_code_updated_at: new Date().toISOString(),
    })
    .eq("id", venue.id)
    .eq("owner_user_id", userId)
    .select(VENUE_OWNER_COLUMNS)
    .single();

  if (error) {
    await client.storage.from(QR_BUCKET).remove([storagePath]);
    throw error;
  }

  if (venue.qrCodeStoragePath && venue.qrCodeStoragePath !== storagePath) {
    await client.storage.from(QR_BUCKET).remove([venue.qrCodeStoragePath]).catch(() => null);
  }

  return toVenueOwnerProfile(client, data);
}

export async function deleteVenueQrCode(client: DancrClient, userId: string): Promise<VenueOwnerProfile> {
  const venue = await requireVenueForAccount(client, userId);
  const { data, error } = await client
    .from("venues")
    .update({
      qr_code_storage_path: null,
      qr_code_label: null,
      qr_code_updated_at: null,
    })
    .eq("id", venue.id)
    .eq("owner_user_id", userId)
    .select(VENUE_OWNER_COLUMNS)
    .single();

  if (error) throw error;
  if (venue.qrCodeStoragePath) {
    await client.storage.from(QR_BUCKET).remove([venue.qrCodeStoragePath]).catch(() => null);
  }
  return toVenueOwnerProfile(client, data);
}

export async function uploadVenueCoverImage(
  client: DancrClient,
  userId: string,
  file: Blob,
): Promise<VenueOwnerProfile> {
  const venue = await requireVenueForAccount(client, userId);
  const image = await validateAndPrepareDancrImage(file);
  if (image.width < 720 || image.height < 720) {
    throw new Error("Venue cover image must be at least 720 by 720 pixels.");
  }

  const ratio = image.width / image.height;
  if (ratio < 0.65 || ratio > 1.9) {
    throw new Error("Choose a portrait, square, or landscape venue image.");
  }

  const tempPath = `${userId}/venue-cover/${venue.id}/${Date.now()}-${image.storageFileName}`;
  let finalPath = "";
  let finalUploaded = false;

  try {
    const { error: tempUploadError } = await client.storage
      .from(MODERATION_TEMP_BUCKET)
      .upload(tempPath, image.buffer, {
        contentType: image.contentType,
        cacheControl: "300",
        upsert: false,
      });
    if (tempUploadError) throw tempUploadError;

    const evaluation = evaluateDancrImageModeration(
      await moderateImageWithOpenAI(client, tempPath),
    );
    if (evaluation.decision !== "approved") {
      console.warn("VENUE_COVER_MODERATION_BLOCKED", {
        venueId: venue.id,
        decision: evaluation.decision,
        reasonCodes: evaluation.reasonCodes,
      });
      throw new Error(
        evaluation.decision === "rejected"
          ? "This image does not meet the venue cover safety requirements."
          : "This image could not be published automatically. Choose a different venue image.",
      );
    }

    const uploadedImage = await uploadResponsiveImage(
      client,
      COVER_BUCKET,
      venue.id,
      image,
      "31536000",
      { archiveOriginal: true, watermark: true },
    );
    finalPath = uploadedImage.storagePath;
    finalUploaded = true;

    const { data, error } = await client
      .from("venues")
      .update({
        cover_image_storage_path: finalPath,
        cover_image_updated_at: new Date().toISOString(),
      })
      .eq("id", venue.id)
      .eq("owner_user_id", userId)
      .select(VENUE_OWNER_COLUMNS)
      .single();

    if (error) throw error;
    if (venue.coverImageStoragePath && venue.coverImageStoragePath !== finalPath) {
      await removeResponsiveImage(
        client,
        COVER_BUCKET,
        venue.coverImageStoragePath,
      ).catch(() => null);
      await removeArchivedOriginalMedia(
        client,
        COVER_BUCKET,
        venue.coverImageStoragePath,
      ).catch(() => null);
    }
    console.info("VENUE_COVER_PUBLISHED", { venueId: venue.id });
    return toVenueOwnerProfile(client, data);
  } catch (error) {
    if (finalUploaded) {
      await removeResponsiveImage(client, COVER_BUCKET, finalPath).catch(
        () => null,
      );
      await removeArchivedOriginalMedia(client, COVER_BUCKET, finalPath).catch(
        () => null,
      );
    }
    throw error;
  } finally {
    await client.storage.from(MODERATION_TEMP_BUCKET).remove([tempPath]).catch(() => null);
  }
}

export async function deleteVenueCoverImage(
  client: DancrClient,
  userId: string,
): Promise<VenueOwnerProfile> {
  const venue = await requireVenueForAccount(client, userId);
  const { data, error } = await client
    .from("venues")
    .update({
      cover_image_storage_path: null,
      cover_image_updated_at: null,
    })
    .eq("id", venue.id)
    .eq("owner_user_id", userId)
    .select(VENUE_OWNER_COLUMNS)
    .single();

  if (error) throw error;
  if (venue.coverImageStoragePath) {
    await removeResponsiveImage(
      client,
      COVER_BUCKET,
      venue.coverImageStoragePath,
    ).catch(() => null);
    await removeArchivedOriginalMedia(
      client,
      COVER_BUCKET,
      venue.coverImageStoragePath,
    ).catch(() => null);
  }
  console.info("VENUE_COVER_REMOVED", { venueId: venue.id });
  return toVenueOwnerProfile(client, data);
}

export async function getVenueDashboard(
  client: DancrClient,
  userId: string,
): Promise<{
  profile: VenueOwnerProfile;
  analytics: VenueDashboardAnalytics;
  workingNow: VenueDashboardDancer[];
  deal: ClubDeal | null;
  dealRevenue: Awaited<ReturnType<typeof getVenueDealRevenueMetrics>>;
}> {
  const profile = await requireVenueForAccount(client, userId);
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 30);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const [
    totalFollowers,
    followersGained30Days,
    directions30Days,
    pageViews30Days,
    pageViewsToday,
    qrImpressions30Days,
    dancerProfileQrImpressions30Days,
    upcomingShiftCount,
    goingSignals30Days,
    workingNow,
    venueDeal,
    dealRevenue,
  ] = await Promise.all([
    countByVenue(client, "venue_follows", profile.id),
    countByVenueSince(client, "venue_follows", profile.id, "created_at", since),
    countByVenueSince(client, "direction_requests", profile.id, "requested_at", since),
    countVenueEvents(client, profile.id, "page_view", since),
    countVenueEvents(client, profile.id, "page_view", today),
    countVenueEvents(client, profile.id, "qr_impression", since),
    countVenueEvents(client, profile.id, "qr_impression", since, "dancer_profile"),
    countUpcomingShifts(client, profile.id, now),
    countVenueGoingSignals(client, profile.id, since),
    getWorkingDancers(client, profile.id, now),
    getVenueDealForAccount(client, userId),
    getVenueDealRevenueMetrics(client, profile.id),
  ]);

  return {
    profile,
    analytics: {
      totalFollowers,
      followersGained30Days,
      directions30Days,
      pageViews30Days,
      pageViewsToday,
      qrImpressions30Days,
      dancerProfileQrImpressions30Days,
      upcomingShiftCount,
      activeDancersNow: workingNow.length,
      goingSignals30Days,
    },
    workingNow,
    deal: venueDeal?.deal || null,
    dealRevenue,
  };
}

const VENUE_OWNER_COLUMNS =
  "id, owner_user_id, slug, name, city, state, address, phone, website, timezone, opens_at, closes_at, is_active, cover_image_storage_path, cover_image_updated_at, qr_code_storage_path, qr_code_label, qr_code_updated_at";

async function requireVenueForAccount(client: DancrClient, userId: string) {
  const venue = await getVenueForAccount(client, userId);
  if (!venue) throw new Error("Venue profile not found.");
  return venue;
}

function toVenueOwnerProfile(client: DancrClient, row: any): VenueOwnerProfile {
  const coverImage = responsivePublicImage(
    client,
    COVER_BUCKET,
    row.cover_image_storage_path,
  );
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    state: row.state || null,
    address: row.address || null,
    phone: row.phone || null,
    website: row.website || null,
    timezone: row.timezone,
    opensAt: row.opens_at || null,
    closesAt: row.closes_at || null,
    isActive: row.is_active !== false,
    coverImageStoragePath: row.cover_image_storage_path || null,
    coverImageUrl: coverImage?.imageUrl || null,
    coverImageSrcSet: coverImage?.imageSrcSet || null,
    coverImageWidth: coverImage?.imageWidth || null,
    coverImageHeight: coverImage?.imageHeight || null,
    coverImageUpdatedAt: row.cover_image_updated_at || null,
    qrCodeStoragePath: row.qr_code_storage_path || null,
    qrCodeUrl: row.qr_code_storage_path
      ? client.storage.from(QR_BUCKET).getPublicUrl(row.qr_code_storage_path).data.publicUrl
      : null,
    qrCodeLabel: row.qr_code_label || null,
    qrCodeUpdatedAt: row.qr_code_updated_at || null,
  };
}

async function countByVenue(client: DancrClient, table: string, venueId: string) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("venue_id", venueId);
  if (error) throw error;
  return count || 0;
}

async function countByVenueSince(client: DancrClient, table: string, venueId: string, column: string, since: Date) {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .gte(column, since.toISOString());
  if (error) throw error;
  return count || 0;
}

async function countVenueEvents(
  client: DancrClient,
  venueId: string,
  eventType: "page_view" | "qr_impression",
  since: Date,
  source?: "venue_page" | "dancer_profile",
) {
  let query = client
    .from("venue_page_events")
    .select("*", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .eq("event_type", eventType)
    .gte("occurred_at", since.toISOString());
  if (source) query = query.eq("source", source);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function countUpcomingShifts(client: DancrClient, venueId: string, now: Date) {
  const { count, error } = await client
    .from("shifts")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId)
    .eq("status", "posted")
    .gt("ends_at", now.toISOString());
  if (error) throw error;
  return count || 0;
}

async function countVenueGoingSignals(client: DancrClient, venueId: string, since: Date) {
  const { count, error } = await client
    .from("going_signals")
    .select("shift_id, shifts!inner(venue_id)", { count: "exact", head: true })
    .eq("shifts.venue_id", venueId)
    .gte("created_at", since.toISOString());
  if (error) throw error;
  return count || 0;
}

async function getWorkingDancers(client: DancrClient, venueId: string, now: Date): Promise<VenueDashboardDancer[]> {
  const { data, error } = await client
    .from("shifts")
    .select("id, starts_at, ends_at, location_status, checked_in_at, checked_out_at, location_verification_expires_at, dancer_profiles(id, slug, stage_name)")
    .eq("venue_id", venueId)
    .eq("status", "posted")
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .lte("starts_at", now.toISOString())
    .gte("ends_at", now.toISOString())
    .in("location_status", ["location_confirmed", "club_confirmed"])
    .order("checked_in_at", { ascending: false });
  if (error) throw error;

  return (data || []).filter((row: any) => isCurrentLocationVerification(row, now.getTime())).map((row: any) => {
    const dancer = Array.isArray(row.dancer_profiles) ? row.dancer_profiles[0] : row.dancer_profiles;
    return {
      shiftId: row.id,
      dancerId: dancer?.id || "",
      dancerSlug: dancer?.slug || "",
      stageName: dancer?.stage_name || "Dancer",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      checkedInAt: row.checked_in_at,
      locationStatus: row.location_status,
    };
  });
}

function requiredText(value: string, label: string, min: number, max: number) {
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${label} must be ${min} to ${max} characters.`);
  if (/[<>]/.test(text)) throw new Error(`${label} contains unsupported characters.`);
  return text;
}

function optionalText(value: string | null | undefined, label: string, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  if (/[<>]/.test(text)) throw new Error(`${label} contains unsupported characters.`);
  return text;
}

function optionalUrl(value: string | null | undefined) {
  const text = optionalText(value, "Website", 300);
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Website must be a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Website must use http or https.");
  return url.toString();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
