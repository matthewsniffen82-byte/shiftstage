import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { prepareFaceCenteredAvatar } from "../src/lib/dancr/avatar-face.ts";
import { validateAndPrepareDancrImage } from "../src/lib/dancr/image-validation.ts";
import {
  removeArchivedOriginalMedia,
} from "../src/lib/dancr/media-watermark.ts";
import {
  removeResponsiveImage,
  responsivePublicImage,
  uploadResponsiveImage,
} from "../src/lib/dancr/responsive-image.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const OPERATION_CONFIRMATION = "mydancr-demo-media-v1";
const PHOTO_BUCKET = "dancer-photos";
const PROTECTED_STAR_SLUG = "lvdegen11";
const PROTECTED_STAR_NAME = "star";

export const DEMO_PROFILE_MEDIA_ASSIGNMENTS = Object.freeze([
  ["layout-review-01", "grok-image-ee1cb5e4-2266-4dc5-bb4a-f5370e3f3b3e.jpg"],
  ["layout-review-02", "grok-image-1d7a783c-b4ab-49df-ba04-a164774d0fb6.jpg"],
  ["layout-review-03", "grok-image-3da028fe-f206-4e88-8e18-6865cc572c96.jpg"],
  ["layout-review-04", "grok-image-33ea80e3-40f6-4ba8-af47-9ccd1d8f5698.jpg"],
  ["layout-review-05", "grok-image-70c7fbae-e7ca-43b6-a6aa-7a594b09b343.jpg"],
  ["layout-review-06", "grok-image-62dfe570-d11d-4031-8c0f-8e32206f3124.jpg"],
  ["layout-review-07", "grok-image-226a6f83-e5f0-4d74-8b74-57c3c0e1d3fe.jpg"],
  ["layout-review-08", "grok-image-288c8097-c8a5-4288-a09b-91e23a05f516.jpg"],
  ["layout-review-09", "grok-image-c651ae4b-214f-4970-8d17-acd609fc81a7.jpg"],
  ["layout-review-10", "grok-image-912f9f5e-2625-478e-9a59-2876d36b8d94.jpg"],
].map(([slug, fileName]) => Object.freeze({ slug, fileName })));

const cli = parseArguments(process.argv.slice(2));
const mode = readMode(cli);
const target = readRequiredValue(cli, "--target");
if (target !== "production") {
  throw new Error("--target must be production for this guarded content operation.");
}
if (mode === "apply" && cli.get("--confirm") !== OPERATION_CONFIRMATION) {
  throw new Error(`Production writes require --confirm=${OPERATION_CONFIRMATION}.`);
}

const inputDirectory = resolveInputDirectory(readRequiredValue(cli, "--input-dir"));
const env = readEnvironment();
const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const protectedStarBefore = await loadProtectedStarSnapshot();
const targets = await loadTargetProfiles();
const prepared = await prepareSourceMedia(mode === "apply");

if (mode === "inspect") {
  writeResult({
    event: "demo_profile_media.inspected",
    target,
    environmentFingerprint: environmentFingerprint(),
    protectedProfile: protectedStarBefore.profile.slug,
    assignments: prepared.map((item) => ({
      slug: item.target.profile.slug,
      stageName: item.target.profile.stage_name,
      fileName: item.assignment.fileName,
      sourceBytes: item.sourceBytes,
      sourceWidth: item.image.width,
      sourceHeight: item.image.height,
      currentPrimaryStoragePath: item.target.photo.storage_path,
      currentAvatarStoragePath: item.target.profile.avatar_storage_path || null,
    })),
  });
} else {
  await applyReplacements();
}

async function loadTargetProfiles() {
  const requestedSlugs = DEMO_PROFILE_MEDIA_ASSIGNMENTS.map((item) => item.slug);
  const { data: profiles, error: profileError } = await admin
    .from("dancer_profiles")
    .select("id, user_id, slug, stage_name, status, is_public, avatar_storage_path, avatar_updated_at, photo_review_status, updated_at")
    .in("slug", requestedSlugs);
  assertSuccess(profileError, "load target demo profiles");

  const profilesBySlug = new Map((profiles || []).map((profile) => [profile.slug, profile]));
  if (profilesBySlug.size !== DEMO_PROFILE_MEDIA_ASSIGNMENTS.length) {
    const missing = requestedSlugs.filter((slug) => !profilesBySlug.has(slug));
    throw new Error(`Every assigned demo profile must exist. Missing: ${missing.join(", ") || "unknown"}.`);
  }

  const profileIds = [...profilesBySlug.values()].map((profile) => profile.id);
  const { data: photos, error: photoError } = await admin
    .from("dancer_photos")
    .select("id, dancer_id, storage_path, is_primary, sort_order, review_status, alt_text")
    .in("dancer_id", profileIds)
    .eq("is_primary", true)
    .eq("review_status", "approved");
  assertSuccess(photoError, "load current demo primary photos");

  return DEMO_PROFILE_MEDIA_ASSIGNMENTS.map((assignment) => {
    const profile = profilesBySlug.get(assignment.slug);
    assertDemoProfileIsReplaceable(profile, protectedStarBefore.profile.id);
    const primaryPhotos = (photos || []).filter((photo) => photo.dancer_id === profile.id);
    if (primaryPhotos.length !== 1) {
      throw new Error(`${profile.slug} must have exactly one approved primary photo before replacement.`);
    }
    return { assignment, profile, photo: primaryPhotos[0] };
  });
}

async function prepareSourceMedia(includeAvatar) {
  const preparedMedia = [];
  for (const targetProfile of targets) {
    const sourcePath = safeSourcePath(targetProfile.assignment.fileName);
    const source = await readFile(sourcePath);
    const image = await validateAndPrepareDancrImage(
      new Blob([source], { type: "image/jpeg" }),
    );
    const avatar = includeAvatar
      ? await prepareFaceCenteredAvatar(image)
      : null;
    preparedMedia.push({
      ...targetProfile,
      sourcePath,
      sourceBytes: source.byteLength,
      image,
      avatar,
      target: targetProfile,
    });
    console.info(JSON.stringify({
      event: "demo_profile_media.source_prepared",
      slug: targetProfile.profile.slug,
      sourceWidth: image.width,
      sourceHeight: image.height,
      avatarWidth: avatar?.width || null,
      avatarHeight: avatar?.height || null,
    }));
  }
  return preparedMedia;
}

async function applyReplacements() {
  const uploaded = [];
  const mutations = [];
  try {
    for (const item of prepared) {
      if (!item.avatar) throw new Error(`Avatar preparation failed for ${item.profile.slug}.`);
      const upload = {
        item,
        main: null,
        avatar: null,
      };
      uploaded.push(upload);
      upload.main = await uploadResponsiveImage(
        admin,
        PHOTO_BUCKET,
        `${item.profile.user_id}/${item.profile.id}`,
        item.image,
        "31536000",
        { archiveOriginal: true, watermark: true },
      );
      upload.avatar = await uploadResponsiveImage(
        admin,
        PHOTO_BUCKET,
        `${item.profile.user_id}/${item.profile.id}/avatar`,
        item.avatar,
        "31536000",
      );
    }

    for (const upload of uploaded) {
      await applyDatabaseMutation(upload, mutations);
    }

    await verifyAppliedState(uploaded);
    await assertProtectedStarUnchanged(protectedStarBefore);
  } catch (error) {
    await rollbackMutations(mutations);
    await cleanupNewUploads(uploaded);
    throw error;
  }

  const cleanupWarnings = await cleanupSupersededMedia(uploaded);
  writeResult({
    event: "demo_profile_media.replaced",
    target,
    environmentFingerprint: environmentFingerprint(),
    protectedProfile: protectedStarBefore.profile.slug,
    replacements: uploaded.map(({ item, main, avatar }) => ({
      slug: item.profile.slug,
      stageName: item.profile.stage_name,
      fileName: item.assignment.fileName,
      mainStoragePath: main.storagePath,
      mainWidth: main.width,
      mainHeight: main.height,
      mainImageUrl: publicImageUrl(main.storagePath),
      avatarStoragePath: avatar.storagePath,
      avatarWidth: avatar.width,
      avatarHeight: avatar.height,
      avatarImageUrl: publicImageUrl(avatar.storagePath),
    })),
    cleanupWarnings,
  });
}

async function applyDatabaseMutation(upload, mutations) {
  const { item, main, avatar } = upload;
  const mutation = {
    upload,
    photoUpdated: false,
    profileUpdated: false,
    moderationRecords: [],
    moderationUpdated: false,
  };
  mutations.push(mutation);

  const { data: moderationRecords, error: moderationReadError } = await admin
    .from("image_moderation_records")
    .select("id, final_storage_path")
    .eq("image_id", item.photo.id);
  assertSuccess(moderationReadError, `load moderation records for ${item.profile.slug}`);
  mutation.moderationRecords = moderationRecords || [];

  const { data: photo, error: photoError } = await admin
    .from("dancer_photos")
    .update({
      storage_path: main.storagePath,
      review_status: "approved",
    })
    .eq("id", item.photo.id)
    .eq("dancer_id", item.profile.id)
    .eq("storage_path", item.photo.storage_path)
    .select("id")
    .maybeSingle();
  if (photoError || !photo) {
    throw photoError || new Error(`${item.profile.slug} changed before its primary photo could be replaced.`);
  }
  mutation.photoUpdated = true;

  let profileUpdate = admin
    .from("dancer_profiles")
    .update({
      avatar_storage_path: avatar.storagePath,
      avatar_updated_at: new Date().toISOString(),
      photo_review_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.profile.id);
  profileUpdate = item.profile.avatar_storage_path
    ? profileUpdate.eq("avatar_storage_path", item.profile.avatar_storage_path)
    : profileUpdate.is("avatar_storage_path", null);
  const { data: profile, error: profileError } = await profileUpdate
    .select("id")
    .maybeSingle();
  if (profileError || !profile) {
    throw profileError || new Error(`${item.profile.slug} changed before its avatar could be replaced.`);
  }
  mutation.profileUpdated = true;

  if (mutation.moderationRecords.length) {
    const recordIds = mutation.moderationRecords.map((record) => record.id);
    const { data: changed, error: moderationUpdateError } = await admin
      .from("image_moderation_records")
      .update({
        final_storage_path: main.storagePath,
        decision: "approved",
        status: "approved",
        updated_at: new Date().toISOString(),
      })
      .in("id", recordIds)
      .select("id");
    if (moderationUpdateError || (changed || []).length !== recordIds.length) {
      throw moderationUpdateError || new Error(`Moderation record synchronization failed for ${item.profile.slug}.`);
    }
    mutation.moderationUpdated = true;
  }

}

async function verifyAppliedState(uploaded) {
  for (const { item, main, avatar } of uploaded) {
    const [{ data: photo, error: photoError }, { data: profile, error: profileError }] = await Promise.all([
      admin
        .from("dancer_photos")
        .select("id, storage_path, is_primary, review_status")
        .eq("id", item.photo.id)
        .single(),
      admin
        .from("dancer_profiles")
        .select("id, slug, stage_name, avatar_storage_path, photo_review_status")
        .eq("id", item.profile.id)
        .single(),
    ]);
    assertSuccess(photoError, `verify primary photo for ${item.profile.slug}`);
    assertSuccess(profileError, `verify avatar for ${item.profile.slug}`);
    if (
      photo.storage_path !== main.storagePath ||
      photo.is_primary !== true ||
      photo.review_status !== "approved" ||
      profile.avatar_storage_path !== avatar.storagePath ||
      profile.photo_review_status !== "approved"
    ) {
      throw new Error(`Production verification failed for ${item.profile.slug}.`);
    }
  }
}

async function rollbackMutations(mutations) {
  for (const mutation of [...mutations].reverse()) {
    const { item } = mutation.upload;
    if (mutation.moderationUpdated) {
      for (const record of mutation.moderationRecords) {
        await admin
          .from("image_moderation_records")
          .update({
            final_storage_path: record.final_storage_path,
            updated_at: new Date().toISOString(),
          })
          .eq("id", record.id)
          .catch(() => null);
      }
    }
    if (mutation.profileUpdated) {
      await admin
        .from("dancer_profiles")
        .update({
          avatar_storage_path: item.profile.avatar_storage_path,
          avatar_updated_at: item.profile.avatar_updated_at,
          photo_review_status: item.profile.photo_review_status,
          updated_at: item.profile.updated_at,
        })
        .eq("id", item.profile.id)
        .catch(() => null);
    }
    if (mutation.photoUpdated) {
      await admin
        .from("dancer_photos")
        .update({
          storage_path: item.photo.storage_path,
          review_status: item.photo.review_status,
        })
        .eq("id", item.photo.id)
        .catch(() => null);
    }
  }
}

async function cleanupNewUploads(uploaded) {
  for (const upload of uploaded) {
    if (upload.main?.storagePath) {
      await removeResponsiveImage(admin, PHOTO_BUCKET, upload.main.storagePath).catch(() => null);
      await removeArchivedOriginalMedia(admin, PHOTO_BUCKET, upload.main.storagePath).catch(() => null);
    }
    if (upload.avatar?.storagePath) {
      await removeResponsiveImage(admin, PHOTO_BUCKET, upload.avatar.storagePath).catch(() => null);
    }
  }
}

async function cleanupSupersededMedia(uploaded) {
  const warnings = [];
  for (const { item } of uploaded) {
    const operations = [
      ["primary_public", () => removeResponsiveImage(admin, PHOTO_BUCKET, item.photo.storage_path)],
      ["primary_original", () => removeArchivedOriginalMedia(admin, PHOTO_BUCKET, item.photo.storage_path)],
      ["avatar_public", () => removeResponsiveImage(admin, PHOTO_BUCKET, item.profile.avatar_storage_path)],
    ];
    for (const [kind, operation] of operations) {
      if (kind === "avatar_public" && !item.profile.avatar_storage_path) continue;
      try {
        await operation();
      } catch (error) {
        warnings.push({
          slug: item.profile.slug,
          kind,
          message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        });
      }
    }
  }
  return warnings;
}

async function loadProtectedStarSnapshot() {
  const { data: profiles, error: profileError } = await admin
    .from("dancer_profiles")
    .select("id, slug, stage_name, avatar_storage_path, avatar_updated_at, updated_at")
    .or(`slug.eq.${PROTECTED_STAR_SLUG},stage_name.ilike.Star`);
  assertSuccess(profileError, "load protected Star profile");
  if ((profiles || []).length !== 1) {
    throw new Error("Exactly one protected Star profile must exist before this operation can run.");
  }
  const profile = profiles[0];
  const { data: photos, error: photoError } = await admin
    .from("dancer_photos")
    .select("id, storage_path, is_primary, review_status, sort_order")
    .eq("dancer_id", profile.id)
    .order("sort_order", { ascending: true });
  assertSuccess(photoError, "load protected Star photos");
  return { profile, photos: photos || [] };
}

async function assertProtectedStarUnchanged(snapshot) {
  const current = await loadProtectedStarSnapshot();
  if (stableSnapshot(current) !== stableSnapshot(snapshot)) {
    throw new Error("The protected Star profile changed; all demo replacements were rolled back.");
  }
}

function assertDemoProfileIsReplaceable(profile, protectedProfileId) {
  if (!profile || !String(profile.slug || "").startsWith("layout-review-")) {
    throw new Error("Only marked layout-review demo profiles can be changed.");
  }
  if (
    profile.id === protectedProfileId ||
    String(profile.slug || "").toLowerCase() === PROTECTED_STAR_SLUG ||
    String(profile.stage_name || "").trim().toLowerCase() === PROTECTED_STAR_NAME
  ) {
    throw new Error("The protected Star profile cannot be changed by this operation.");
  }
}

function safeSourcePath(fileName) {
  const resolved = path.resolve(inputDirectory, fileName);
  const relative = path.relative(inputDirectory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe source path for ${fileName}.`);
  }
  return resolved;
}

function resolveInputDirectory(value) {
  const resolved = path.resolve(process.cwd(), value);
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new Error("--input-dir must point to a specific media directory.");
  }
  return resolved;
}

function publicImageUrl(storagePath) {
  return responsivePublicImage(admin, PHOTO_BUCKET, storagePath)?.imageUrl || null;
}

function stableSnapshot(value) {
  return JSON.stringify(value);
}

function parseArguments(argv) {
  const parsed = new Map();
  for (const argument of argv) {
    const [name, ...valueParts] = argument.split("=");
    parsed.set(name, valueParts.length ? valueParts.join("=") : true);
  }
  return parsed;
}

function readMode(argumentsMap) {
  const selected = ["--inspect", "--apply"].filter((flag) => argumentsMap.has(flag));
  if (selected.length !== 1) throw new Error("Choose exactly one mode: --inspect or --apply.");
  return selected[0].slice(2);
}

function readRequiredValue(argumentsMap, flag) {
  const value = String(argumentsMap.get(flag) || "").trim();
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function readEnvironment() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return { supabaseUrl, serviceRoleKey };
}

function environmentFingerprint() {
  return createHash("sha256")
    .update(`${env.supabaseUrl}|${env.serviceRoleKey}`)
    .digest("hex")
    .slice(0, 12);
}

function assertSuccess(error, operation) {
  if (error) throw new Error(`${operation} failed: ${error.message || "Unknown Supabase error"}`);
}

function writeResult(result) {
  console.log(JSON.stringify(result, null, 2));
}
