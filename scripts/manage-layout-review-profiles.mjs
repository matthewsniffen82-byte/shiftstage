import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const DATASET_MARKER = "mydancr-layout-review-v1";
const PROFILE_PREFIX = "layout-review-";
const EMAIL_DOMAIN = "synthetic.mydancr.invalid";
const DEFAULT_COUNT = 20;
const MAX_COUNT = 50;
const REVIEW_CITY = "Las Vegas";
const REVIEW_PHOTO_COUNT = 3;
const UPCOMING_SHIFT_COUNT = 14;
const AUTH_BAN_DURATION = "876000h";

const STAGE_NAMES = [
  "Preview Aurora",
  "Preview Bella",
  "Preview Celeste",
  "Preview Dahlia",
  "Preview Ember",
  "Preview Freya",
  "Preview Gia",
  "Preview Halo",
  "Preview Indigo",
  "Preview Jade",
  "Preview Kira",
  "Preview Luna",
  "Preview Monroe",
  "Preview Nova",
  "Preview Opal",
  "Preview Phoenix",
  "Preview Quinn",
  "Preview Raven",
  "Preview Sienna",
  "Preview Venus",
];

const PALETTES = [
  ["#12082b", "#7428d7", "#35d8ff", "#f9a8d4"],
  ["#1a081f", "#b42378", "#7c3aed", "#7eeaff"],
  ["#071827", "#075985", "#22c55e", "#c084fc"],
  ["#211006", "#b45309", "#ec4899", "#a78bfa"],
  ["#07131f", "#0f766e", "#06b6d4", "#f472b6"],
];

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

  writeResult({
    mode,
    target,
    supabaseHost: new URL(env.supabaseUrl).host,
    environmentFingerprint: environmentFingerprint(),
    datasetMarker: DATASET_MARKER,
    datasetProfiles: profiles.length,
    publicProfiles,
    activeReviewVenues: venues.length,
  });
}

async function applyDataset() {
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
      await upsertProfileSocialLinks(profile, definition);
      await replaceProfileSchedule(profile, definition, venues);
    }
  } catch (error) {
    await rollbackNewUsers(createdUserIds);
    throw error;
  }

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
    if (
      !String(profile.slug || "").startsWith(PROFILE_PREFIX) ||
      !String(profile.bio || "").includes(DATASET_MARKER)
    ) {
      throw new Error(`Refusing to delete unmarked profile ${profile.id}.`);
    }

    const { data: photos, error: photoError } = await admin
      .from("dancer_photos")
      .select("storage_path")
      .eq("dancer_id", profile.id);
    assertSuccess(photoError, `read storage paths for ${profile.slug}`);

    const paths = (photos || [])
      .map((photo) => String(photo.storage_path || ""))
      .filter((path) => path.includes(`/${DATASET_MARKER}-`));
    if (paths.length) {
      const { error: storageError } = await admin.storage
        .from("dancer-photos")
        .remove(paths);
      assertSuccess(storageError, `remove storage objects for ${profile.slug}`);
    }

    const { error: userError } = await admin.auth.admin.deleteUser(profile.user_id);
    assertSuccess(userError, `delete marked auth account for ${profile.slug}`);
  }

  const remaining = await listDatasetProfiles();
  if (remaining.length) {
    throw new Error(`${remaining.length} marked review profiles remain after cleanup.`);
  }

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
      bio: `[${DATASET_MARKER}] Synthetic layout-review profile. This is not a real dancer or work schedule.`,
      city: REVIEW_CITY,
      disabled_at: null,
      is_public: true,
      photo_review_status: "approved",
      real_name: null,
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
    const storagePath = `${userId}/${profile.id}/${DATASET_MARKER}-${photoIndex + 1}.png`;
    expectedPaths.push(storagePath);
    const buffer = await createReviewPortrait(definition, photoIndex);
    const { error: uploadError } = await admin.storage
      .from("dancer-photos")
      .upload(storagePath, buffer, {
        cacheControl: "3600",
        contentType: "image/png",
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
      alt_text: `Synthetic layout-review artwork for ${definition.stageName}`,
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
    throw new Error(`Refusing to replace unrecognized photos on ${definition.slug}.`);
  }
}

async function upsertProfileSocialLinks(profile, definition) {
  const links = [
    {
      dancer_id: profile.id,
      handle: `${definition.slug}_instagram`,
      is_active: true,
      platform: "instagram",
      url: "https://www.instagram.com/",
    },
    {
      dancer_id: profile.id,
      handle: `${definition.slug}_tiktok`,
      is_active: true,
      platform: "tiktok",
      url: "https://www.tiktok.com/",
    },
  ];
  const { error } = await admin
    .from("social_links")
    .upsert(links, { onConflict: "dancer_id,platform" });
  assertSuccess(error, `upsert social links for ${definition.slug}`);
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
    working_status: "self_reported",
  });
  assertSuccess(error, `insert upcoming shift for ${definition.slug}`);
}

async function createReviewPortrait(definition, photoIndex) {
  const palette = PALETTES[(definition.index + photoIndex) % PALETTES.length];
  const rotation = (definition.index * 17 + photoIndex * 23) % 360;
  const initials = definition.stageName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const safeName = escapeXml(definition.stageName);
  const svg = `
    <svg width="900" height="1200" viewBox="0 0 900 1200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${palette[0]}"/>
          <stop offset=".52" stop-color="${palette[1]}"/>
          <stop offset="1" stop-color="#020204"/>
        </linearGradient>
        <radialGradient id="spotlight">
          <stop offset="0" stop-color="${palette[2]}" stop-opacity=".78"/>
          <stop offset="1" stop-color="${palette[2]}" stop-opacity="0"/>
        </radialGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="18"/></filter>
      </defs>
      <rect width="900" height="1200" fill="url(#background)"/>
      <circle cx="${180 + photoIndex * 260}" cy="${220 + definition.index * 11}" r="360" fill="url(#spotlight)" opacity=".54"/>
      <path d="M-80 1060 L980 210" stroke="${palette[3]}" stroke-width="34" opacity=".16"/>
      <path d="M-40 1170 L940 320" stroke="${palette[2]}" stroke-width="5" opacity=".75" filter="url(#glow)"/>
      <g transform="translate(450 610) rotate(${rotation / 18 - 10})">
        <ellipse cx="0" cy="-180" rx="166" ry="210" fill="#07070c" opacity=".92"/>
        <circle cx="0" cy="-150" r="116" fill="${palette[3]}" opacity=".78"/>
        <path d="M-185 250 C-160 40 -86 -12 0 -12 C86 -12 160 40 185 250 Z" fill="#08080e"/>
        <path d="M-116 250 C-96 82 -52 36 0 36 C52 36 96 82 116 250 Z" fill="${palette[1]}" opacity=".92"/>
      </g>
      <circle cx="450" cy="580" r="290" fill="none" stroke="${palette[2]}" stroke-width="2" opacity=".46"/>
      <text x="44" y="72" fill="#ffffff" opacity=".74" font-family="Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="7">LAYOUT REVIEW</text>
      <text x="44" y="1108" fill="#ffffff" font-family="Arial, sans-serif" font-size="68" font-weight="800">${initials}</text>
      <text x="44" y="1160" fill="#ffffff" opacity=".74" font-family="Arial, sans-serif" font-size="24">${safeName} · ${photoIndex + 1}/${REVIEW_PHOTO_COUNT}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

async function listDatasetProfiles() {
  const { data, error } = await admin
    .from("dancer_profiles")
    .select("id, user_id, slug, stage_name, city, bio")
    .like("slug", `${PROFILE_PREFIX}%`)
    .order("slug", { ascending: true });
  assertSuccess(error, "list layout-review profiles");
  return (data || []).filter((profile) =>
    String(profile.bio || "").includes(DATASET_MARKER),
  );
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
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("LAYOUT_REVIEW_ROLLBACK_FAILED", {
        userId,
        message: error.message,
      });
    }
  }
}

function profileDefinition(index) {
  const ordinal = String(index + 1).padStart(2, "0");
  return {
    email: `${PROFILE_PREFIX}${ordinal}@${EMAIL_DOMAIN}`,
    index,
    slug: `${PROFILE_PREFIX}${ordinal}`,
    stageName: STAGE_NAMES[index] || `Preview Dancer ${ordinal}`,
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

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapePostgrestValue(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function writeResult(result) {
  console.log(JSON.stringify(result, null, 2));
}
