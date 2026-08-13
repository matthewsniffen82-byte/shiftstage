import process from "node:process";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.env.DANCR_ENV_DIR?.trim() || process.cwd());

const OPERATION_CONFIRMATION = "mydancr-three-upcoming-v1";
const DATASET_MARKER = "mydancr-layout-review-v1";
const MANAGED_BY = "manage-demo-upcoming";
const UPCOMING_COUNT = 3;
const EMAIL_DOMAIN = "synthetic.mydancr.invalid";
const DEMO_PROFILE_SLUGS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `layout-review-${String(index + 1).padStart(2, "0")}`),
);
const FEATURED_VENUE_SLUGS = Object.freeze([
  "peppermint-hippo-las-vegas",
  "spearmint-rhino-las-vegas",
  "sapphire-las-vegas",
]);

const cli = parseArguments(process.argv.slice(2));
const mode = readMode(cli);
const target = readRequiredValue(cli, "--target");
if (target !== "production") {
  throw new Error("--target must be production for this guarded Demo Mode operation.");
}
if (mode !== "inspect" && cli.get("--confirm") !== OPERATION_CONFIRMATION) {
  throw new Error(`Production writes require --confirm=${OPERATION_CONFIRMATION}.`);
}

const env = readEnvironment();
const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

if (mode === "inspect") {
  await inspectState();
} else if (mode === "apply") {
  await applyAssignments();
} else {
  await removeAssignments();
}

async function inspectState() {
  const profiles = await loadEligibleProfiles();
  const profileIds = profiles.map((profile) => profile.id);
  const now = new Date().toISOString();
  const [workingNowIds, upcoming] = await Promise.all([
    loadWorkingNowDancerIds(profileIds, now),
    loadUpcomingAssignments(profileIds, now),
  ]);

  writeResult({
    event: "demo_upcoming.inspected",
    target,
    eligibleProfileCount: profiles.length,
    workingNowCount: workingNowIds.size,
    upcomingCount: upcoming.length,
    upcoming: upcoming.map(publicAssignment),
  });
}

async function applyAssignments() {
  const [profiles, venues] = await Promise.all([
    loadEligibleProfiles(),
    loadFeaturedVenues(),
  ]);
  for (const profile of profiles) {
    await assertMarkedDemoAccount(profile);
  }

  const now = new Date().toISOString();
  const profileIds = profiles.map((profile) => profile.id);
  const workingNowIds = await loadWorkingNowDancerIds(profileIds, now);
  const candidates = profiles.filter((profile) => !workingNowIds.has(String(profile.id)));
  if (candidates.length < UPCOMING_COUNT) {
    throw new Error(
      `Three non-working eligible demo profiles are required; found ${candidates.length}.`,
    );
  }

  const existingUpcoming = await loadUpcomingAssignments(
    candidates.map((profile) => profile.id),
    now,
  );
  const existingDancerIds = new Set(existingUpcoming.map((shift) => String(shift.dancer_id)));
  const selectedProfiles = [...candidates]
    .sort((left, right) => {
      const existingDifference = Number(existingDancerIds.has(String(right.id)))
        - Number(existingDancerIds.has(String(left.id)));
      return existingDifference || String(left.slug).localeCompare(String(right.slug));
    })
    .slice(0, UPCOMING_COUNT);

  await clearUpcomingAssignments(candidates.map((profile) => profile.id), now);

  const assignedAt = new Date().toISOString();
  const rows = selectedProfiles.map((profile, index) => {
    const venue = venues[index];
    const timezone = venue.timezone || "America/Los_Angeles";
    const shiftDate = localDateAfterDays(timezone, index + 1);
    const window = scheduleDateWindow(shiftDate, timezone);
    return {
      dancer_id: profile.id,
      venue_id: venue.id,
      shift_date: shiftDate,
      shift_source: "scheduled",
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      timezone,
      status: "posted",
      checked_in_at: null,
      checked_out_at: null,
      location_status: "self_reported",
      location_verification_expires_at: null,
      working_status: "self_reported",
      commission_tracking_started_at: null,
      commission_tracking_stopped_at: null,
      shift_summary: {
        demoUpcoming: true,
        managedBy: MANAGED_BY,
        assignedAt,
      },
    };
  });

  const { data, error } = await admin
    .from("shifts")
    .insert(rows)
    .select(
      "id, dancer_id, venue_id, shift_date, shift_source, starts_at, ends_at, checked_in_at, shift_summary, dancer_profiles(stage_name, slug), venues(name, slug)",
    );
  assertSuccess(error, "create three managed Demo Mode upcoming assignments");
  if ((data || []).length !== UPCOMING_COUNT) {
    throw new Error(`Expected three inserted assignments; received ${(data || []).length}.`);
  }

  const verification = await loadUpcomingAssignments(
    candidates.map((profile) => profile.id),
    now,
  );
  if (verification.length !== UPCOMING_COUNT) {
    throw new Error(
      `Expected exactly three upcoming demo dancers after verification; found ${verification.length}.`,
    );
  }
  if (verification.some((shift) => workingNowIds.has(String(shift.dancer_id)))) {
    throw new Error("A Working Now dancer was incorrectly assigned to Upcoming.");
  }

  writeResult({
    event: "demo_upcoming.applied",
    target,
    workingNowCount: workingNowIds.size,
    upcomingCount: verification.length,
    upcoming: verification.map(publicAssignment),
  });
}

async function removeAssignments() {
  const profiles = await loadEligibleProfiles();
  for (const profile of profiles) {
    await assertMarkedDemoAccount(profile);
  }
  const profileIds = profiles.map((profile) => profile.id);
  const now = new Date().toISOString();
  const managed = (await loadUpcomingAssignments(profileIds, now)).filter(isManagedUpcoming);
  if (managed.length) {
    const { error } = await admin
      .from("shifts")
      .delete()
      .in("id", managed.map((shift) => shift.id))
      .eq("shift_source", "scheduled");
    assertSuccess(error, "remove managed Demo Mode upcoming assignments");
  }
  writeResult({
    event: "demo_upcoming.removed",
    target,
    removedCount: managed.length,
    upcoming: managed.map(publicAssignment),
  });
}

async function loadEligibleProfiles() {
  const { data, error } = await admin
    .from("dancer_profiles")
    .select(
      "id, user_id, slug, stage_name, city, status, verification_status, photo_review_status, is_public, disabled_at, dancer_photos(id, review_status)",
    )
    .in("slug", DEMO_PROFILE_SLUGS)
    .eq("status", "approved")
    .eq("verification_status", "approved")
    .eq("photo_review_status", "approved")
    .eq("is_public", true)
    .is("disabled_at", null)
    .ilike("city", "Las Vegas")
    .order("slug", { ascending: true });
  assertSuccess(error, "load eligible fictional demo profiles");

  return (data || []).filter((profile) =>
    (profile.dancer_photos || []).some((photo) => photo.review_status === "approved"),
  );
}

async function loadFeaturedVenues() {
  const { data, error } = await admin
    .from("venues")
    .select("id, slug, name, city, timezone, is_active")
    .in("slug", FEATURED_VENUE_SLUGS)
    .eq("is_active", true)
    .ilike("city", "Las Vegas");
  assertSuccess(error, "load featured Las Vegas venues");
  const bySlug = new Map((data || []).map((venue) => [String(venue.slug), venue]));
  const missing = FEATURED_VENUE_SLUGS.filter((slug) => !bySlug.has(slug));
  if (missing.length) {
    throw new Error(`Missing active featured venues: ${missing.join(", ")}.`);
  }
  return FEATURED_VENUE_SLUGS.map((slug) => bySlug.get(slug));
}

async function loadWorkingNowDancerIds(profileIds, now) {
  if (!profileIds.length) return new Set();
  const { data, error } = await admin
    .from("shifts")
    .select("dancer_id")
    .in("dancer_id", profileIds)
    .eq("status", "posted")
    .lte("starts_at", now)
    .gte("ends_at", now)
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .in("location_status", ["location_confirmed", "club_confirmed"])
    .gt("location_verification_expires_at", now);
  assertSuccess(error, "load active Working Now demo dancers");
  return new Set((data || []).map((shift) => String(shift.dancer_id)));
}

async function loadUpcomingAssignments(profileIds, now) {
  if (!profileIds.length) return [];
  const { data, error } = await admin
    .from("shifts")
    .select(
      "id, dancer_id, venue_id, shift_date, shift_source, starts_at, ends_at, checked_in_at, shift_summary, dancer_profiles(stage_name, slug), venues(name, slug)",
    )
    .in("dancer_id", profileIds)
    .eq("status", "posted")
    .eq("shift_source", "scheduled")
    .gte("ends_at", now)
    .is("checked_out_at", null)
    .order("starts_at", { ascending: true });
  assertSuccess(error, "load upcoming demo dancer assignments");
  return data || [];
}

async function clearUpcomingAssignments(profileIds, now) {
  const current = await loadUpcomingAssignments(profileIds, now);
  if (!current.length) return;
  const { error } = await admin
    .from("shifts")
    .delete()
    .in("id", current.map((shift) => shift.id))
    .eq("shift_source", "scheduled");
  assertSuccess(error, "replace upcoming schedules for non-working demo profiles");
}

async function assertMarkedDemoAccount(profile) {
  const { data, error } = await admin.auth.admin.getUserById(profile.user_id);
  assertSuccess(error, `read demo auth account for ${profile.slug}`);
  const user = data?.user;
  const email = String(user?.email || "").toLowerCase();
  if (
    user?.user_metadata?.dataset_marker !== DATASET_MARKER
    || !email.startsWith("layout-review-")
    || !email.endsWith(`@${EMAIL_DOMAIN}`)
  ) {
    throw new Error(`Refusing to mutate unmarked demo account ${profile.slug}.`);
  }
}

function publicAssignment(row) {
  const profile = joined(row.dancer_profiles);
  const venue = joined(row.venues);
  return {
    stageName: profile?.stage_name || null,
    profileSlug: profile?.slug || null,
    venueName: venue?.name || null,
    venueSlug: venue?.slug || null,
    shiftDate: row.shift_date || null,
  };
}

function isManagedUpcoming(shift) {
  return shift?.shift_summary?.demoUpcoming === true
    && shift?.shift_summary?.managedBy === MANAGED_BY;
}

function joined(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function localDateAfterDays(timeZone, days) {
  const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(future);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function scheduleDateWindow(shiftDate, timeZone) {
  const [year, month, day] = shiftDate.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    startsAt: zonedDateTimeToUtc(year, month, day, 0, 1, timeZone).toISOString(),
    endsAt: zonedDateTimeToUtc(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      0,
      1,
      timeZone,
    ).toISOString(),
  };
}

function zonedDateTimeToUtc(year, month, day, hour, minute, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcGuess);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  const localAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return new Date(utcGuess.getTime() - (localAsUtc - utcGuess.getTime()));
}

function parseArguments(args) {
  const parsed = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    if (argument.includes("=")) {
      const [key, ...value] = argument.split("=");
      parsed.set(key, value.join("="));
    } else {
      parsed.set(argument, args[index + 1]);
      index += 1;
    }
  }
  return parsed;
}

function readMode(argumentsMap) {
  const value = argumentsMap.get("--mode");
  if (!value || !["inspect", "apply", "remove"].includes(value)) {
    throw new Error("--mode must be inspect, apply, or remove.");
  }
  return value;
}

function readRequiredValue(argumentsMap, key) {
  const value = argumentsMap.get(key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function readEnvironment() {
  const supabaseUrl = normalizeEnvironmentValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = normalizeEnvironmentValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
    throw new Error("The production Supabase URL must use an official HTTPS Supabase host.");
  }
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey };
}

function normalizeEnvironmentValue(value) {
  let normalized = String(value || "").trim();
  while (
    normalized.length >= 2
    && ((normalized.startsWith('"') && normalized.endsWith('"'))
      || (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\\[nr]+$/g, "").trim();
}

function assertSuccess(error, operation) {
  if (error) throw new Error(`Unable to ${operation}: ${error.message}`);
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
