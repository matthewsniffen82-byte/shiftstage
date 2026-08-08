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
const WORKING_NOW_PROFILE_INDEXES = new Set([5, 6, 7, 8, 9]);
const FEATURED_WORKING_NOW_VENUE_SLUGS = [
  "peppermint-hippo-las-vegas",
  "spearmint-rhino-las-vegas",
  "sapphire-las-vegas",
];
const ACTIVE_REVIEW_VENUE_COUNT = FEATURED_WORKING_NOW_VENUE_SLUGS.length;
const WORKING_NOW_REMAINING_HOURS = 10;
const REVIEW_DEAL_PAYOUT_CENTS = 1;
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
} else if (mode === "sync-deals") {
  await syncDealsOnly();
} else if (mode === "sync-schedules") {
  await syncSchedulesOnly();
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
  const [approvedPhotos, socialLinks, upcomingShifts, workingNowShifts, reviewDeals] =
    await Promise.all([
      countRowsForProfiles("dancer_photos", profileIds),
      countRowsForProfiles("social_links", profileIds),
      countRowsForProfiles("shifts", profileIds),
      countWorkingNowShifts(profileIds),
      listMarkedReviewDeals(),
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
    workingNowShifts,
    reviewDeals: reviewDeals.length,
    publicProfiles,
    activeReviewVenues: venues.length,
  });
}

async function applyDataset() {
  await Promise.all(
    PROFILE_DEFINITIONS.map((definition) =>
      validateProfileSheet(definition.sourceUrl),
    ),
  );
  await removeOrphanedDatasetStorageObjects();
  const venues = await listReviewVenues();
  if (!venues.length) {
    throw new Error(`No active ${REVIEW_CITY} venues are available for layout-review schedules.`);
  }
  const reviewQrVenues = await prepareReviewQrVenues(venues);

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
      await replaceProfileSchedule(profile, definition, venues, reviewQrVenues);
    }
  } catch (error) {
    await rollbackNewUsers(createdUserIds);
    throw error;
  }

  await removeProfilesOutsideRequestedSet(count);
  const profiles = await listDatasetProfiles();
  const profileIds = profiles.map((profile) => profile.id);
  const [photoCount, shiftCount, workingNowCount, reviewDeals] =
    await Promise.all([
      countRowsForProfiles("dancer_photos", profileIds),
      countRowsForProfiles("shifts", profileIds),
      countWorkingNowShifts(profileIds),
      listMarkedReviewDeals(),
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
    workingNowShifts: workingNowCount,
    activeQrVenues: reviewQrVenues.map((venue) => venue.name),
    reviewDeals: reviewDeals.length,
    signInDisabled: true,
  });
}

async function syncDealsOnly() {
  const venues = await listReviewVenues();
  const selectedVenues = await prepareReviewQrVenues(venues);
  const reviewDeals = await listMarkedReviewDeals();

  writeResult({
    mode,
    target,
    supabaseHost: new URL(env.supabaseUrl).host,
    environmentFingerprint: environmentFingerprint(),
    datasetMarker: DATASET_MARKER,
    reviewDeals: reviewDeals.length,
    activeReviewVenues: selectedVenues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      slug: venue.slug,
    })),
  });
}

async function syncSchedulesOnly() {
  const [profiles, venues] = await Promise.all([
    listDatasetProfiles(),
    listReviewVenues(),
  ]);
  const profilesBySlug = new Map(
    profiles.map((profile) => [String(profile.slug), profile]),
  );
  const scheduleTargets = Array.from({ length: count }, (_, index) => {
    const definition = profileDefinition(index);
    return {
      definition,
      profile: profilesBySlug.get(definition.slug),
    };
  });
  const missingProfileSlugs = scheduleTargets
    .filter((target) => !target.profile)
    .map((target) => target.definition.slug);
  if (missingProfileSlugs.length) {
    throw new Error(
      `Missing marked review profiles: ${missingProfileSlugs.join(", ")}.`,
    );
  }
  for (const target of scheduleTargets) {
    await assertMarkedDatasetAccount(target.profile);
  }

  const selectedVenues = await prepareReviewQrVenues(venues);
  const workingNowAssignments = [];

  for (const { definition, profile } of scheduleTargets) {
    const assignment = await replaceProfileSchedule(
      profile,
      definition,
      venues,
      selectedVenues,
    );
    if (assignment.isWorkingNow) {
      workingNowAssignments.push({
        profile: definition.stageName,
        profileSlug: definition.slug,
        venue: assignment.venue.name,
        venueSlug: assignment.venue.slug,
      });
    }
  }

  const profileIds = profiles.map((profile) => profile.id);
  const workingNowShifts = await countWorkingNowShifts(profileIds);
  if (workingNowShifts !== WORKING_NOW_PROFILE_INDEXES.size) {
    throw new Error(
      `Expected ${WORKING_NOW_PROFILE_INDEXES.size} Working Now shifts but found ${workingNowShifts}.`,
    );
  }

  writeResult({
    mode,
    target,
    datasetMarker: DATASET_MARKER,
    workingNowAssignments,
    workingNowShifts,
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
  await removeMarkedReviewDeals();
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
  const primaryPhotoIndex = Number.isInteger(definition.primaryPhotoIndex)
    ? definition.primaryPhotoIndex
    : 0;

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
      is_primary: photoIndex === primaryPhotoIndex,
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

async function replaceProfileSchedule(
  profile,
  definition,
  venues,
  reviewQrVenues,
) {
  const { error: deleteError } = await admin
    .from("shifts")
    .delete()
    .eq("dancer_id", profile.id);
  assertSuccess(deleteError, `reset review schedule for ${definition.slug}`);

  const workingNowIndexes = [...WORKING_NOW_PROFILE_INDEXES];
  const workingNowSlot = workingNowIndexes.indexOf(definition.index);
  const isWorkingNow = workingNowSlot >= 0;
  const venue = isWorkingNow
    ? reviewQrVenues[workingNowSlot % reviewQrVenues.length]
    : venues[definition.index % venues.length];
  const now = Date.now();
  const startsAt = new Date(
    isWorkingNow
      ? now - 20 * 60 * 1000
      : now + (4 + definition.index * 8) * 60 * 60 * 1000,
  );
  const endsAt = new Date(
    isWorkingNow
      ? now + WORKING_NOW_REMAINING_HOURS * 60 * 60 * 1000
      : startsAt.getTime() + 6 * 60 * 60 * 1000,
  );
  const { error } = await admin.from("shifts").insert({
    checked_in_at: isWorkingNow
      ? new Date(Date.now() - 20 * 60 * 1000).toISOString()
      : null,
    checked_out_at: null,
    dancer_id: profile.id,
    ends_at: endsAt.toISOString(),
    location_status: isWorkingNow ? "club_confirmed" : "self_reported",
    starts_at: startsAt.toISOString(),
    status: "posted",
    timezone: venue.timezone || "America/Los_Angeles",
    venue_id: venue.id,
  });
  assertSuccess(error, `insert review schedule for ${definition.slug}`);
  return { isWorkingNow, venue };
}

async function prepareReviewQrVenues(venues) {
  if (venues.length < ACTIVE_REVIEW_VENUE_COUNT) {
    throw new Error(
      `At least ${ACTIVE_REVIEW_VENUE_COUNT} active ${REVIEW_CITY} venues are required for QR review.`,
    );
  }

  const activeDeals = await listActiveQrDeals();
  const realDealVenueIds = new Set(
    activeDeals
      .filter((deal) => !isMarkedReviewDeal(deal))
      .map((deal) => String(deal.venue_id)),
  );
  const featuredVenues = FEATURED_WORKING_NOW_VENUE_SLUGS.map((slug) =>
    venues.find((venue) => venue.slug === slug),
  );
  const missingFeaturedSlugs = FEATURED_WORKING_NOW_VENUE_SLUGS.filter(
    (_slug, index) => !featuredVenues[index],
  );
  if (missingFeaturedSlugs.length) {
    throw new Error(
      `Missing required Working Now venues: ${missingFeaturedSlugs.join(", ")}.`,
    );
  }
  const featuredVenueIds = new Set(
    featuredVenues.map((venue) => String(venue.id)),
  );
  const selected = [
    ...featuredVenues,
    ...venues.filter(
      (venue) =>
        !featuredVenueIds.has(String(venue.id)) &&
        realDealVenueIds.has(String(venue.id)),
    ),
    ...venues.filter(
      (venue) =>
        !featuredVenueIds.has(String(venue.id)) &&
        !realDealVenueIds.has(String(venue.id)),
    ),
  ].slice(0, ACTIVE_REVIEW_VENUE_COUNT);
  const fallbackVenues = selected.filter(
    (venue) => !realDealVenueIds.has(String(venue.id)),
  );

  await syncMarkedReviewDeals(fallbackVenues);
  return selected;
}

async function listActiveQrDeals() {
  const { data, error } = await admin
    .from("club_deals")
    .select("id, venue_id, redemption_rules")
    .eq("is_active", true)
    .eq("payout_type", "flat")
    .gt("payout_amount_cents", 0)
    .order("created_at", { ascending: false });
  assertSuccess(error, "list active QR deals");
  return data || [];
}

async function listMarkedReviewDeals() {
  const { data, error } = await admin
    .from("club_deals")
    .select("id, venue_id, redemption_rules")
    .contains("redemption_rules", { dataset_marker: DATASET_MARKER });
  assertSuccess(error, "list marked layout-review deals");
  return data || [];
}

async function syncMarkedReviewDeals(venues) {
  const existing = await listMarkedReviewDeals();
  const retainedIds = new Set();

  for (const venue of venues) {
    const matching = existing.filter(
      (deal) => String(deal.venue_id) === String(venue.id),
    );
    const values = {
      deal_description:
        "Open a tracked MyDancr QR to review the complete Club Deal experience.",
      deal_terms:
        "Layout-review offer only. No monetary value and not redeemable.",
      deal_title: "Tonight's Layout Review Offer",
      is_active: true,
      payout_amount_cents: REVIEW_DEAL_PAYOUT_CENTS,
      payout_type: "flat",
      redemption_rules: {
        club_scan_required: true,
        dataset_marker: DATASET_MARKER,
        layout_review_only: true,
        one_per_guest: true,
      },
      updated_at: new Date().toISOString(),
    };

    if (matching.length) {
      const { data, error } = await admin
        .from("club_deals")
        .update(values)
        .eq("id", matching[0].id)
        .select("id")
        .single();
      assertSuccess(error, `update layout-review deal for ${venue.name}`);
      retainedIds.add(String(data.id));
    } else {
      const { data, error } = await admin
        .from("club_deals")
        .insert({
          ...values,
          currency: "usd",
          venue_id: venue.id,
        })
        .select("id")
        .single();
      assertSuccess(error, `insert layout-review deal for ${venue.name}`);
      retainedIds.add(String(data.id));
    }
  }

  const staleIds = existing
    .map((deal) => String(deal.id))
    .filter((id) => !retainedIds.has(id));
  if (staleIds.length) {
    const { error } = await admin.from("club_deals").delete().in("id", staleIds);
    assertSuccess(error, "remove stale layout-review deals");
  }
}

async function removeMarkedReviewDeals() {
  const deals = await listMarkedReviewDeals();
  if (!deals.length) return;
  const { error } = await admin
    .from("club_deals")
    .delete()
    .in("id", deals.map((deal) => deal.id));
  assertSuccess(error, "remove marked layout-review deals");
}

function isMarkedReviewDeal(deal) {
  return deal?.redemption_rules?.dataset_marker === DATASET_MARKER;
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

async function countWorkingNowShifts(profileIds) {
  if (!profileIds.length) return 0;
  const now = new Date().toISOString();
  const { count: total, error } = await admin
    .from("shifts")
    .select("id", { count: "exact", head: true })
    .in("dancer_id", profileIds)
    .eq("status", "posted")
    .lte("starts_at", now)
    .gte("ends_at", now)
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .in("location_status", ["location_confirmed", "club_confirmed"]);
  assertSuccess(error, "count Working Now layout-review shifts");
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
  const selected = [
    "--inspect",
    "--apply",
    "--sync-deals",
    "--sync-schedules",
    "--cleanup",
  ].filter((flag) => argumentsMap.has(flag));
  if (selected.length !== 1) {
    throw new Error(
      "Choose exactly one mode: --inspect, --apply, --sync-deals, --sync-schedules, or --cleanup.",
    );
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
