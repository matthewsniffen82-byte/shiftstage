import crypto from "node:crypto";
import process from "node:process";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.env.DANCR_ENV_DIR?.trim() || process.cwd());

const OPERATION_CONFIRMATION = "mydancr-six-working-now-v1";
const LOCKED_UNTIL = "2099-12-31T23:59:59.999Z";
const DEMO_PROFILE_SLUGS = Object.freeze([
  "layout-review-01",
  "layout-review-02",
  "layout-review-03",
  "layout-review-04",
  "layout-review-05",
  "layout-review-06",
  "layout-review-07",
  "layout-review-08",
  "layout-review-09",
  "layout-review-10",
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
  const [profiles, venues, assignments, publicWorkingNow] = await Promise.all([
    loadEligibleProfiles(),
    loadEligibleVenues(),
    loadCurrentAssignments(),
    loadPublicLasVegasWorkingNow(),
  ]);
  writeResult({
    event: "demo_working_now.inspected",
    target,
    eligibleProfileCount: profiles.length,
    eligibleVenueCount: venues.length,
    publicWorkingNowCount: publicWorkingNow.length,
    activeAssignments: assignments.map(publicAssignment),
  });
}

async function applyAssignments() {
  const [profiles, venues] = await Promise.all([
    loadEligibleProfiles(),
    loadEligibleVenues(),
  ]);
  if (profiles.length < 6) {
    throw new Error(`Six eligible fictional demo profiles are required; found ${profiles.length}.`);
  }
  if (!venues.length) {
    throw new Error("At least one active Las Vegas venue is required.");
  }

  const selectedProfiles = shuffled(profiles).slice(0, 6);
  const selectedVenues = shuffled(venues);
  const now = new Date().toISOString();

  await endCurrentDemoAssignments(now, "demo_assignment_replaced");
  await endExistingLasVegasWorkingNow(now);

  const assignments = selectedProfiles.map((profile, index) => {
    const venue = selectedVenues[index % selectedVenues.length];
    return {
      dancer_id: profile.id,
      venue_id: venue.id,
      starts_at: now,
      ends_at: LOCKED_UNTIL,
      timezone: venue.timezone || "America/Los_Angeles",
      status: "posted",
      shift_date: localDate(now, venue.timezone || "America/Los_Angeles"),
      shift_source: "demo_locked",
      checked_in_at: now,
      checked_out_at: null,
      location_status: "club_confirmed",
      last_location_verified_at: now,
      location_verification_expires_at: LOCKED_UNTIL,
      working_status: "club_confirmed",
      commission_tracking_started_at: null,
      commission_tracking_stopped_at: null,
      ended_at: null,
      ended_reason: null,
      nfc_tag_id: null,
      nfc_last_tapped_at: null,
      shift_summary: {
        demoLocked: true,
        managedBy: "manage-demo-working-now",
        assignedAt: now,
      },
    };
  });

  const { data, error } = await admin
    .from("shifts")
    .insert(assignments)
    .select("id, dancer_id, venue_id, shift_source, starts_at, location_verification_expires_at, dancer_profiles(stage_name, slug), venues(name, slug)");
  assertSuccess(error, "create six locked Demo Mode Working Now assignments");
  if ((data || []).length !== 6) {
    throw new Error(`Expected six inserted assignments; received ${(data || []).length}.`);
  }

  writeResult({
    event: "demo_working_now.applied",
    target,
    lockedUntil: LOCKED_UNTIL,
    assignments: (data || []).map(publicAssignment),
  });
}

async function removeAssignments() {
  const now = new Date().toISOString();
  const ended = await endCurrentDemoAssignments(now, "demo_assignment_removed");
  writeResult({
    event: "demo_working_now.removed",
    target,
    removedCount: ended.length,
    assignments: ended.map(publicAssignment),
  });
}

async function loadEligibleProfiles() {
  const { data, error } = await admin
    .from("dancer_profiles")
    .select("id, slug, stage_name, city, status, verification_status, photo_review_status, is_public, disabled_at, dancer_photos(id, review_status)")
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

async function loadEligibleVenues() {
  const { data, error } = await admin
    .from("venues")
    .select("id, slug, name, city, timezone, is_active")
    .eq("is_active", true)
    .ilike("city", "Las Vegas")
    .order("name", { ascending: true });
  assertSuccess(error, "load active Las Vegas venues");
  return data || [];
}

async function loadCurrentAssignments() {
  const { data, error } = await admin
    .from("shifts")
    .select("id, dancer_id, venue_id, shift_source, starts_at, location_verification_expires_at, dancer_profiles(stage_name, slug), venues(name, slug)")
    .eq("shift_source", "demo_locked")
    .eq("status", "posted")
    .is("checked_out_at", null)
    .order("starts_at", { ascending: true });
  assertSuccess(error, "load current Demo Mode Working Now assignments");
  return data || [];
}

async function endCurrentDemoAssignments(now, reason) {
  const current = await loadCurrentAssignments();
  if (!current.length) return [];

  const ids = current.map((assignment) => assignment.id);
  const { error } = await admin
    .from("shifts")
    .update({
      status: "cancelled",
      checked_out_at: now,
      location_verification_expires_at: now,
      working_status: "ended",
      ended_at: now,
      ended_reason: reason,
      updated_at: now,
    })
    .in("id", ids)
    .eq("shift_source", "demo_locked");
  assertSuccess(error, "end current Demo Mode Working Now assignments");
  return current;
}

async function endExistingLasVegasWorkingNow(now) {
  const { data: profiles, error: profileError } = await admin
    .from("dancer_profiles")
    .select("id")
    .ilike("city", "Las Vegas")
    .eq("status", "approved")
    .eq("is_public", true)
    .is("disabled_at", null);
  assertSuccess(profileError, "load public Las Vegas profiles before replacing Working Now");
  const dancerIds = (profiles || []).map((profile) => profile.id);
  if (!dancerIds.length) return [];

  const { data: active, error: activeError } = await admin
    .from("shifts")
    .select("id")
    .in("dancer_id", dancerIds)
    .eq("status", "posted")
    .neq("shift_source", "demo_locked")
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .eq("location_status", "club_confirmed")
    .gt("location_verification_expires_at", now);
  assertSuccess(activeError, "load current public Las Vegas Working Now sessions");
  const ids = (active || []).map((shift) => shift.id);
  if (!ids.length) return [];

  const { error } = await admin
    .from("shifts")
    .update({
      status: "cancelled",
      checked_out_at: now,
      location_verification_expires_at: now,
      working_status: "ended",
      commission_tracking_stopped_at: now,
      ended_at: now,
      ended_reason: "demo_roster_replaced",
      updated_at: now,
    })
    .in("id", ids);
  assertSuccess(error, "replace current public Las Vegas Working Now roster");
  return ids;
}

async function loadPublicLasVegasWorkingNow(now = new Date().toISOString()) {
  const { data: profiles, error: profileError } = await admin
    .from("dancer_profiles")
    .select("id")
    .ilike("city", "Las Vegas")
    .eq("status", "approved")
    .eq("is_public", true)
    .is("disabled_at", null);
  assertSuccess(profileError, "load public Las Vegas profiles for verification");
  const dancerIds = (profiles || []).map((profile) => profile.id);
  if (!dancerIds.length) return [];

  const { data, error } = await admin
    .from("shifts")
    .select("id, shift_source")
    .in("dancer_id", dancerIds)
    .eq("status", "posted")
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .eq("location_status", "club_confirmed")
    .gt("location_verification_expires_at", now);
  assertSuccess(error, "verify the public Las Vegas Working Now roster");
  return data || [];
}

function publicAssignment(row) {
  const profile = joined(row.dancer_profiles);
  const venue = joined(row.venues);
  return {
    stageName: profile?.stage_name || null,
    profileSlug: profile?.slug || null,
    venueName: venue?.name || null,
    venueSlug: venue?.slug || null,
    startedAt: row.starts_at || null,
    lockedUntil: row.location_verification_expires_at || null,
  };
}

function joined(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function localDate(instant, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
    throw new Error("The production Supabase URL must use an official HTTPS Supabase host.");
  }
  return { supabaseUrl, serviceRoleKey };
}

function assertSuccess(error, operation) {
  if (error) throw new Error(`Unable to ${operation}: ${error.message}`);
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
