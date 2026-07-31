import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  createProfilePhoto,
  PROFILE_DEFINITIONS,
  validateProfileSheet,
} from "./layout-review-profile-sheet.mjs";

const DATASET_MARKER = "mydancr-layout-review-v1";
const PROFILE_PREFIX = "layout-review-";
const EMAIL_DOMAIN = "synthetic.mydancr.invalid";
const DEFAULT_COUNT = PROFILE_DEFINITIONS.length;
const MAX_COUNT = PROFILE_DEFINITIONS.length;
const REVIEW_CITY = "Las Vegas";
const REVIEW_PHOTO_COUNT = 5;
const UPCOMING_SHIFT_COUNT = PROFILE_DEFINITIONS.length;
const AUTH_BAN_DURATION = "876000h";
const STORAGE_BUCKET = "dancer-photos";
const STORAGE_PAGE_SIZE = 100;
const STORAGE_SCAN_LIMIT = 10_000;

const cli = parseArguments(process.argv.slice(2));
const target = readRequiredChoice(cli, "--target", ["preview", "production"]);
const mode = readMode(cli);
const count = readCount(cli);

if (mode !== "inspect") {
  const confirmation = String(cli.get("--confirm") || "");
  if (confirmation !== DATASET_MARKER) {
    throw new Error(`Database writes require --confirm=${DATASET_MARKER}.`);
  }
}

const env = readEnvironment();
const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

if (mode === "inspect") {
  await inspectEnvironment();
} else if (mode === "apply") {
  await applyDataset();
} else {
  await cleanupDataset();
}

async function inspectEnvironment() {
  const [profiles, venues, publicProfiles] = await Promise.all([
    listDatasetProfiles(),
    listReviewVenues(),
    countPublicProfiles(),
  ]);
  const profileIds = profiles.map((profile) => profile.id);
  const [approvedPhotos, socialLinks, upcomingShifts] = await Promise.all([
    countRowsForProfiles("dancer_photos", profileIds),
    countRowsForProfiles("social_links", profileIds),
    countRowsForProfiles("shifts", profileIds),
  ]);

  writeResult({
    mode,
    target,
    supabaseHost: new URL(env.supabaseUrl).host,
    environmentFingerprint: environmentFingerprint(),
    datasetMarker: DATASET_MARKER,
    datasetProfiles: profiles.length,
    profileNames: profiles.map((profile) => profile.stage_name),
    approvedPhotos,
    socialLinks,
    upcomingShifts,
    publicProfiles,
    activeReviewVenues: venues.length,
  });
}

async function applyDataset() {
  await validateProfileSheet();
  await removeOrphanedDatasetStorageObjects();
  const venues = await listReviewVenues();
  if (!venues.length) {
    throw new Error(`No active ${REVIEW_CITY} venues are available for layout-review schedules.`);
  }

  const authUsers = await listAllAuthUsers();
  const authUsersByEmail = new Map(
    authUsers.map((user) => [String(user.email || "").toLowerCase(), user]),
  );
  const createdUserIds = [];

  try {
    for (let index = 0; index < count; index += 1) {
      const definition = profileDefinition(index);
      const emailKey = definition.email.toLowerCase();
      let authUser = authUsersByEmail.get(emailKey);

      if (authUser && authUser.user_metadata?.dataset_marker !== DATASET_MARKER) {
        throw new Error(`Refusing to reuse unmarked auth account ${definition.email}.`);
      }

      if (!authUser) {
        const { data, error } = await admin.auth.admin.createUser({
          email: definition.email,
          password: randomBytes(32).toString("base64url"),
          email_confirm: true,
          user_metadata: {
            city: REVIEW_CITY,
            dataset_marker: DATASET_MARKER,
            display_name: definition.stageName,
            role: "dancer",
            stage_name: definition.stageName,
          },
        });
        assertSuccess(error, `create auth account ${definition.email}`);
        authUser = data.user;
        if (!authUser) throw new Error(`Supabase did not return ${definition.email}.`);
        createdUserIds.push(authUser.id);
        authUsersByEmail.set(emailKey, authUser);
      }

      const { error: banError } = await admin.auth.admin.updateUserById(authUser.id, {
        ban_duration: AUTH_BAN_DURATION,
        user_metadata: {
          ...(authUser.user_metadata || {}),
          city: REVIEW_CITY,
          dataset_marker: DATASET_MARKER,
          display_name: definition.stageName,
          role: "dancer",
          stage_name: definition.stageName,
        },
      });
      assertSuccess(banError, `disable sign-in for ${definition.email}`);

      const profile = await approveSyntheticProfile(authUser.id, definition);
      await upsertProfilePhotos(profile, definition, authUser.id);
      await removeProfileSocialLinks(profile, definition);
      await replaceProfileSchedule(profile, definition, venues);
    }
  } catch (error) {
    await rollbackNewUsers(createdUserIds);
    throw error;
  }

  await removeProfilesOutsideRequestedSet(count);
  const profiles = await listDatasetProfiles();
  const profileIds = profiles.map((profile) => profile.id);
  const [photoCount, shiftCount] = await Promise.all([
    countRowsForProfiles("dancer_photos", profileIds),
    countRowsForProfiles("shifts", profileIds),
  ]);

  if (profiles.length !== count) {
    throw new Error(`Expected ${count} review profiles but found ${profiles.length}.`);
  }
  if (photoCount !== count * REVIEW_PHOTO_COUNT) {
    throw new Error(
      `Expected ${count * REVIEW_PHOTO_COUNT} review photos but found ${photoCount}.`,
    );
  }

  writeResult({
    mode,
    target,
    datasetMarker: DATASET_MARKER,
    profiles: profiles.length,
    approvedPhotos: photoCount,
    upcomingShifts: shiftCount,
    workingNowShifts: 0,
    signInDisabled: true,
  });
}

async function cleanupDataset() {
  const profiles = await listDatasetProfiles();
  if (profiles.length > MAX_COUNT) {
    throw new Error(
      `Refusing cleanup because ${profiles.length} profiles exceeds the ${MAX_COUNT}-profile safety limit.`,
    );
  }

  for (const profile of profiles) {
    if (!String(profile.slug || "").startsWith(PROFILE_PREFIX)) {
      throw new Error(`Refusing to delete unmarked profile ${profile.id}.`);
    }
    await removeDatasetProfile(profile);
  }

  const remaining = await listDatasetProfiles();
  if (remaining.length) {
    throw new Error(`${remaining.length} marked review profiles remain after cleanup.`);
  }
  await removeOrphanedDatasetStorageObjects();

  writeResult({
    mode,
    target,
    datasetMarker: DATASET_MARKER,
    removedProfiles: profiles.length,
  });
}

async function approveSyntheticProfile(userId, definition) {
  const { data: existing, error: readError } = await admin
    .from("dancer_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  assertSuccess(readError, `read profile for ${definition.email}`);
  if (!existing) {
    throw new Error(`Auth bootstrap did not create a dancer profile for ${definition.email}.`);
  }

  const approvedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("dancer_profiles")
    .update({
      approved_at: approvedAt,
      bio: null,
      city: REVIEW_CITY,
      disabled_at: null,
      is_public: true,
      photo_review_status: "approved",
      real_name: definition.stageName,
      slug: definition.slug,
      stage_name: definition.stageName,
      status: "approved",
      updated_at: approvedAt,
      verification_status: "approved",
    })
    .eq("id", existing.id)
    .select("id, user_id, slug, stage_name")
    .single();
  assertSuccess(error, `approve profile ${definition.slug}`);
  return data;
}

async function upsertProfilePhotos(profile, definition, userId) {
  const expectedPaths = [];

  for (let photoIndex = 0; photoIndex < REVIEW_PHOTO_COUNT; photoIndex += 1) {
    const storagePath = `${userId}/${profile.id}/${DATASET_MARKER}-${photoIndex + 1}.jpg`;
    expectedPaths.push(storagePath);
    const buffer = await createProfilePhoto(definition, photoIndex);
    const { error: uploadError } = await admin.storage
      .from("dancer-photos")
      .upload(storagePath, buffer, {
        cacheControl: "3600",
        contentType: "image/jpeg",
        upsert: true,
      });
    assertSuccess(uploadError, `upload photo ${photoIndex + 1} for ${definition.slug}`);

    const { data: existingRows, error: readError } = await admin
      .from("dancer_photos")
      .select("id")
      .eq("dancer_id", profile.id)
      .eq("storage_path", storagePath);
    assertSuccess(readError, `read photo ${photoIndex + 1} for ${definition.slug}`);

    const photoValues = {
      alt_text: `${definition.stageName} profile photo ${photoIndex + 1}`,
      is_primary: photoIndex === 0,
      review_status: "approved",
      sort_order: photoIndex,
    };
    if (existingRows?.length) {
      const { error: updateError } = await admin
        .from("dancer_photos")
        .update(photoValues)
        .eq("id", existingRows[0].id);
      assertSuccess(updateError, `update photo ${photoIndex + 1} for ${definition.slug}`);
      if (existingRows.length > 1) {
        const duplicateIds = existingRows.slice(1).map((row) => row.id);
        const { error: duplicateError } = await admin
          .from("dancer_photos")
          .delete()
          .in("id", duplicateIds);
        assertSuccess(duplicateError, `remove duplicate photo rows for ${definition.slug}`);
      }
    } else {
      const { error: insertError } = await admin.from("dancer_photos").insert({
        dancer_id: profile.id,
        storage_path: storagePath,
        ...photoValues,
      });
      assertSuccess(insertError, `insert photo ${photoIndex + 1} for ${definition.slug}`);
    }
  }

  const { data: staleRows, error: staleReadError } = await admin
    .from("dancer_photos")
    .select("id, storage_path")
    .eq("dancer_id", profile.id)
    .not("storage_path", "in", `(${expectedPaths.map(escapePostgrestValue).join(",")})`);
  assertSuccess(staleReadError, `read stale photos for ${definition.slug}`);
  if (staleRows?.length) {
    const recognized = staleRows.filter((photo) =>
      String(photo.storage_path || "").includes(`/${DATASET_MARKER}-`),
    );
    if (recognized.length !== staleRows.length) {
      throw new Error(`Refusing to replace unrecognized photos on ${definition.slug}.`);
    }
    const staleIds = recognized.map((photo) => photo.id);
    const stalePaths = recognized.map((photo) => String(photo.storage_path));
    const { error: deleteError } = await admin
      .from("dancer_photos")
      .delete()
      .in("id", staleIds);
    assertSuccess(deleteError, `remove prior photos for ${definition.slug}`);
    await removeStoragePaths(stalePaths);
  }
}

async function removeProfileSocialLinks(profile, definition) {
  const { error } = await admin
    .from("social_links")
    .delete()
    .eq("dancer_id", profile.id);
  assertSuccess(error, `remove temporary social links for ${definition.slug}`);
}

async function replaceProfileSchedule(profile, definition, venues) {
  const { error: deleteError } = await admin
    .from("shifts")
    .delete()
    .eq("dancer_id", profile.id);
  assertSuccess(deleteError, `reset review schedule for ${definition.slug}`);

  if (definition.index >= UPCOMING_SHIFT_COUNT) return;

  const venue = venues[definition.index % venues.length];
  const startsAt = new Date(Date.now() + (4 + definition.index * 8) * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);
  const { error } = await admin.from("shifts").insert({
    checked_in_at: null,
    checked_out_at: null,
    dancer_id: profile.id,
    ends_at: endsAt.toISOString(),
    location_status: "self_reported",
    starts_at: startsAt.toISOString(),
    status: "posted",
    timezone: venue.timezone || "America/Los_Angeles",
    venue_id: venue.id,
  });
  assertSuccess(error, `insert upcoming shift for ${definition.slug}`);
}

async function listDatasetProfiles() {
  const { data, error } = await admin
    .from("dancer_profiles")
    .select("id, user_id, slug, stage_name, city, bio")
    .like("slug", `${PROFILE_PREFIX}%`)
    .order("slug", { ascending: true });
  assertSuccess(error, "list layout-review profiles");
  return data || [];
}

async function removeProfilesOutsideRequestedSet(requestedCount) {
  const expectedSlugs = new Set(
    Array.from({ length: requestedCount }, (_, index) => profileDefinition(index).slug),
  );
  const profiles = await listDatasetProfiles();
  for (const profile of profiles) {
    if (!expectedSlugs.has(String(profile.slug || ""))) {
      await removeDatasetProfile(profile);
    }
  }
}

async function removeDatasetProfile(profile) {
  await assertMarkedDatasetAccount(profile);

  const { data: photos, error: photoError } = await admin
    .from("dancer_photos")
    .select("storage_path")
    .eq("dancer_id", profile.id);
  assertSuccess(photoError, `read storage paths for ${profile.slug}`);

  const paths = (photos || [])
    .map((photo) => String(photo.storage_path || ""))
    .filter(Boolean);
  if (paths.some((path) => !path.includes(`/${DATASET_MARKER}-`))) {
    throw new Error(`Refusing to delete unrecognized photos on ${profile.slug}.`);
  }
  await removeStoragePaths(paths);

  const { error: userError } = await admin.auth.admin.deleteUser(profile.user_id);
  assertSuccess(userError, `delete marked auth account for ${profile.slug}`);
}

async function assertMarkedDatasetAccount(profile) {
  const { data, error } = await admin.auth.admin.getUserById(profile.user_id);
  assertSuccess(error, `read auth account for ${profile.slug}`);
  const user = data?.user;
  const email = String(user?.email || "").toLowerCase();
  if (
    user?.user_metadata?.dataset_marker !== DATASET_MARKER ||
    !email.startsWith(PROFILE_PREFIX) ||
    !email.endsWith(`@${EMAIL_DOMAIN}`)
  ) {
    throw new Error(`Refusing to mutate unmarked auth account for ${profile.slug}.`);
  }
}

async function listReviewVenues() {
  const { data, error } = await admin
    .from("venues")
    .select("id, name, slug, timezone")
    .eq("city", REVIEW_CITY)
    .eq("is_active", true)
    .order("name", { ascending: true });
  assertSuccess(error, `list active ${REVIEW_CITY} venues`);
  return data || [];
}

async function countPublicProfiles() {
  const { count: total, error } = await admin
    .from("dancer_profiles")
    .select("id", { count: "exact", head: true })
    .eq("city", REVIEW_CITY)
    .eq("is_public", true)
    .eq("status", "approved")
    .eq("verification_status", "approved")
    .is("disabled_at", null);
  assertSuccess(error, "count public profiles");
  return total || 0;
}

async function countRowsForProfiles(table, profileIds) {
  if (!profileIds.length) return 0;
  const { count: total, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .in("dancer_id", profileIds);
  assertSuccess(error, `count ${table}`);
  return total || 0;
}

async function listAllAuthUsers() {
  const users = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    assertSuccess(error, `list auth users page ${page}`);
    const batch = data.users || [];
    users.push(...batch);
    if (batch.length < perPage) return users;
  }
}

async function rollbackNewUsers(userIds) {
  for (const userId of userIds.reverse()) {
    try {
      await removeDatasetStorageForUser(userId);
    } catch (error) {
      console.error("LAYOUT_REVIEW_STORAGE_ROLLBACK_FAILED", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("LAYOUT_REVIEW_ROLLBACK_FAILED", {
        userId,
        message: error.message,
      });
    }
  }
}

async function removeDatasetStorageForUser(userId) {
  const paths = await listDatasetStoragePaths(userId);
  await removeStoragePaths(paths);
}

async function removeOrphanedDatasetStorageObjects() {
  const profiles = await listDatasetProfiles();
  const activeUserIds = new Set(profiles.map((profile) => String(profile.user_id)));
  const paths = await listDatasetStoragePaths();
  const orphaned = paths.filter(
    (path) => !activeUserIds.has(String(path).split("/")[0]),
  );
  await removeStoragePaths(orphaned);
}

async function listDatasetStoragePaths(rootPrefix = "") {
  const paths = [];
  const state = { scanned: 0 };
  await scanStorageFolder(rootPrefix, paths, state);
  return paths;
}

async function scanStorageFolder(prefix, paths, state) {
  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await admin.storage.from(STORAGE_BUCKET).list(prefix, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    assertSuccess(error, `scan storage folder ${prefix || "/"}`);
    const entries = data || [];

    for (const entry of entries) {
      state.scanned += 1;
      if (state.scanned > STORAGE_SCAN_LIMIT) {
        throw new Error(
          `Refusing layout-review storage scan after ${STORAGE_SCAN_LIMIT} entries.`,
        );
      }

      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) {
        if (String(entry.name).startsWith(`${DATASET_MARKER}-`)) {
          paths.push(path);
        }
      } else {
        await scanStorageFolder(path, paths, state);
      }
    }

    if (entries.length < STORAGE_PAGE_SIZE) return;
  }
}

async function removeStoragePaths(paths) {
  for (let index = 0; index < paths.length; index += STORAGE_PAGE_SIZE) {
    const batch = paths.slice(index, index + STORAGE_PAGE_SIZE);
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove(batch);
    assertSuccess(error, "remove layout-review storage objects");
  }
}

function profileDefinition(index) {
  const profile = PROFILE_DEFINITIONS[index];
  if (!profile) {
    throw new Error(`No supplied dancer profile exists at index ${index}.`);
  }
  const ordinal = String(index + 1).padStart(2, "0");
  return {
    ...profile,
    email: `${PROFILE_PREFIX}${ordinal}@${EMAIL_DOMAIN}`,
    index,
    slug: `${PROFILE_PREFIX}${ordinal}`,
  };
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
  const selected = ["--inspect", "--apply", "--cleanup"].filter((flag) =>
    argumentsMap.has(flag),
  );
  if (selected.length !== 1) {
    throw new Error("Choose exactly one mode: --inspect, --apply, or --cleanup.");
  }
  return selected[0].slice(2);
}

function readRequiredChoice(argumentsMap, flag, choices) {
  const value = String(argumentsMap.get(flag) || "");
  if (!choices.includes(value)) {
    throw new Error(`${flag} must be one of: ${choices.join(", ")}.`);
  }
  return value;
}

function readCount(argumentsMap) {
  const value = Number(argumentsMap.get("--count") || DEFAULT_COUNT);
  if (!Number.isInteger(value) || value < 1 || value > MAX_COUNT) {
    throw new Error(`--count must be an integer between 1 and ${MAX_COUNT}.`);
  }
  return value;
}

function readEnvironment() {
  const supabaseUrl = normalizeEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const serviceRoleKey = normalizeEnvironmentValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  if (!/^https?:\/\//i.test(supabaseUrl)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL (${JSON.stringify({
        length: supabaseUrl.length,
        prefixCodePoints: [...supabaseUrl.slice(0, 8)].map((character) =>
          character.codePointAt(0),
        ),
      })}).`,
    );
  }
  return { serviceRoleKey, supabaseUrl: supabaseUrl.replace(/\/$/, "") };
}

function normalizeEnvironmentValue(value) {
  let normalized = String(value || "").trim();
  while (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\\[nr]+$/g, "").trim();
}

function environmentFingerprint() {
  return createHash("sha256")
    .update(`${env.supabaseUrl}|${env.serviceRoleKey}`)
    .digest("hex")
    .slice(0, 12);
}

function assertSuccess(error, operation) {
  if (error) {
    throw new Error(`${operation} failed: ${error.message || "Unknown Supabase error"}`);
  }
}

function escapePostgrestValue(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function writeResult(result) {
  console.log(JSON.stringify(result, null, 2));
}
