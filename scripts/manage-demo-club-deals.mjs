import crypto from "node:crypto";
import process from "node:process";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.env.DANCR_ENV_DIR?.trim() || process.cwd());

const OPERATION_CONFIRMATION = "mydancr-demo-nfc-deals-v1";
const MANAGER_NAME = "manage-demo-club-deals";
const BATCH_VERSION = "v1";
const TARGET_DEAL_COUNT = 6;
const REFERRAL_COMMISSION_CENTS = 500;
const MANAGED_CASHIER_LABEL = "Main cashier · Demo Mode";
const DEAL_TEMPLATES = Object.freeze([
  {
    title: "Half-off admission",
    description: "Receive 50% off the venue's standard general-admission cover charge after cashier confirmation.",
    terms: "One redemption per guest. Discount applies to the standard general-admission cover only. Subject to venue capacity, age requirements, dress code, and house rules.",
  },
  {
    title: "Skip the line",
    description: "Use the venue's designated priority admission line after cashier confirmation.",
    terms: "One redemption per guest. Priority access does not guarantee immediate admission and remains subject to venue capacity, age requirements, dress code, and house rules.",
  },
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
  await applyDeals();
} else {
  await deactivateManagedDeals();
}

async function inspectState() {
  const state = await loadState();
  writeResult({
    event: "demo_nfc_deals.inspected",
    target,
    activeLasVegasVenueCount: state.venues.length,
    activeCashierNfcVenueCount: state.cashierVenueIds.size,
    activeDealVenueCount: state.activeDealVenueIds.size,
    managedActiveDealCount: state.managedDeals.length,
    managedDeals: state.managedDeals.map(publicDeal),
    eligibleVenueCount: candidateVenues(state).length,
  });
}

async function applyDeals() {
  const state = await loadState();
  if (state.managedDeals.length > TARGET_DEAL_COUNT) {
    throw new Error(`Expected no more than ${TARGET_DEAL_COUNT} active managed deals; found ${state.managedDeals.length}.`);
  }

  const missingCount = TARGET_DEAL_COUNT - state.managedDeals.length;
  if (!missingCount) {
    const verified = await verifyManagedDeals();
    writeResult({
      event: "demo_nfc_deals.already_applied",
      target,
      activeDealCount: verified.length,
      deals: verified.map(publicDeal),
    });
    return;
  }

  const candidates = candidateVenues(state);
  if (candidates.length < missingCount) {
    throw new Error(
      `${missingCount} additional active venues with no published Club Deal are required; found ${candidates.length}.`,
    );
  }

  const now = new Date().toISOString();
  const selectedVenues = candidates.slice(0, missingCount);
  const programmingLinks = await provisionMissingCashierTags(selectedVenues, state.cashierVenueIds);
  const rows = selectedVenues.map((venue, index) => {
    const templateIndex = (state.managedDeals.length + index) % DEAL_TEMPLATES.length;
    const template = DEAL_TEMPLATES[templateIndex];
    return {
      venue_id: venue.id,
      deal_title: template.title,
      deal_description: template.description,
      deal_terms: template.terms,
      is_active: true,
      valid_days: null,
      valid_start_time: null,
      valid_end_time: null,
      redemption_rules: {
        one_per_guest: true,
        authenticated_venue_confirmation_required: true,
        cashier_nfc_required: true,
        attribution_policy: "locked_at_issue",
        commission_policy: "dancer-profile-monthly-30-40-50-v1",
        demo_managed: true,
        managed_by: MANAGER_NAME,
        batch_version: BATCH_VERSION,
        template_index: templateIndex,
      },
      payout_type: "flat",
      payout_amount_cents: REFERRAL_COMMISSION_CENTS,
      currency: "usd",
      offer_type: "admission",
      booking_url: null,
      sort_order: 10 + templateIndex,
      updated_at: now,
    };
  });

  const { data, error } = await admin
    .from("club_deals")
    .insert(rows)
    .select("id, venue_id, deal_title, is_active, payout_type, payout_amount_cents, redemption_rules, venues(name, slug)");
  assertSuccess(error, "publish Demo Mode cashier-NFC Club Deals");
  if ((data || []).length !== missingCount) {
    throw new Error(`Expected ${missingCount} inserted deals; received ${(data || []).length}.`);
  }

  const verified = await verifyManagedDeals();
  writeResult({
    event: "demo_nfc_deals.applied",
    target,
    createdCount: (data || []).length,
    activeDealCount: verified.length,
    deals: verified.map(publicDeal),
    newlyProvisionedCashierNfc: programmingLinks,
  });
}

async function deactivateManagedDeals() {
  const state = await loadState();
  if (!state.managedDeals.length) {
    writeResult({ event: "demo_nfc_deals.already_removed", target, deactivatedCount: 0 });
    return;
  }
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("club_deals")
    .update({ is_active: false, updated_at: now })
    .in("id", state.managedDeals.map((deal) => deal.id))
    .select("id");
  assertSuccess(error, "deactivate managed Demo Mode Club Deals");
  writeResult({
    event: "demo_nfc_deals.removed",
    target,
    deactivatedCount: (data || []).length,
  });
}

async function loadState() {
  const [venuesResult, tagsResult, dealsResult, workingResult] = await Promise.all([
    admin
      .from("venues")
      .select("id, name, slug, city, state, is_active")
      .eq("is_active", true)
      .ilike("city", "Las Vegas")
      .order("name", { ascending: true }),
    admin
      .from("nfc_tags")
      .select("id, venue_id, tag_type, status")
      .eq("tag_type", "cashier")
      .eq("status", "active"),
    admin
      .from("club_deals")
      .select("id, venue_id, deal_title, is_active, payout_type, payout_amount_cents, redemption_rules, venues(name, slug)")
      .eq("is_active", true)
      .eq("payout_type", "flat")
      .gt("payout_amount_cents", 0),
    admin
      .from("shifts")
      .select("venue_id")
      .eq("shift_source", "demo_locked")
      .eq("status", "posted")
      .is("checked_out_at", null),
  ]);
  assertSuccess(venuesResult.error, "load active Las Vegas venues");
  assertSuccess(tagsResult.error, "load active cashier NFC stickers");
  assertSuccess(dealsResult.error, "load active Club Deals");
  assertSuccess(workingResult.error, "load locked Demo Mode Working Now venue assignments");

  const deals = dealsResult.data || [];
  return {
    venues: venuesResult.data || [],
    cashierVenueIds: new Set((tagsResult.data || []).map((tag) => tag.venue_id)),
    activeDealVenueIds: new Set(deals.map((deal) => deal.venue_id)),
    managedDeals: deals.filter(isManagedDeal),
    workingVenueIds: new Set((workingResult.data || []).map((shift) => shift.venue_id)),
  };
}

function candidateVenues(state) {
  const managedVenueIds = new Set(state.managedDeals.map((deal) => deal.venue_id));
  const candidates = state.venues.filter((venue) =>
    !state.activeDealVenueIds.has(venue.id)
    && !managedVenueIds.has(venue.id),
  );
  return [
    ...candidates.filter((venue) => !state.workingVenueIds.has(venue.id)),
    ...candidates.filter((venue) => state.workingVenueIds.has(venue.id)),
  ];
}

async function provisionMissingCashierTags(venues, cashierVenueIds) {
  const missing = venues.filter((venue) => !cashierVenueIds.has(venue.id));
  if (!missing.length) return [];

  const adminUserId = await loadActiveAdminUserId();
  const programmed = [];
  for (const venue of missing) {
    const token = crypto.randomBytes(32).toString("base64url");
    const { data, error } = await admin.rpc("provision_admin_venue_nfc_tag", {
      p_tag_id: crypto.randomUUID(),
      p_venue_id: venue.id,
      p_admin_user_id: adminUserId,
      p_tag_type: "cashier",
      p_label: MANAGED_CASHIER_LABEL,
      p_token_digest: crypto.createHash("sha256").update(token, "utf8").digest("hex"),
    });
    assertSuccess(error, `provision the cashier NFC sticker for ${venue.name}`);
    if (!data || data.status !== "active" || data.tag_type !== "cashier") {
      throw new Error(`The cashier NFC sticker for ${venue.name} was not activated.`);
    }
    programmed.push({
      venueName: venue.name,
      venueSlug: venue.slug,
      programmingUrl: `https://mydancr.com/nfc/${token}`,
    });
  }
  return programmed;
}

async function loadActiveAdminUserId() {
  const { data, error } = await admin
    .from("app_users")
    .select("id")
    .eq("role", "admin")
    .eq("account_state", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  assertSuccess(error, "load an active administrator for NFC provisioning audit");
  if (!data?.id) throw new Error("An active administrator is required to provision cashier NFC stickers.");
  return data.id;
}

async function verifyManagedDeals() {
  const state = await loadState();
  if (state.managedDeals.length !== TARGET_DEAL_COUNT) {
    throw new Error(`Expected ${TARGET_DEAL_COUNT} active managed deals; found ${state.managedDeals.length}.`);
  }
  const venueIds = state.managedDeals.map((deal) => deal.venue_id);
  if (new Set(venueIds).size !== TARGET_DEAL_COUNT) {
    throw new Error("Every managed Demo Mode Club Deal must belong to a different venue.");
  }
  const missingCashierNfc = venueIds.filter((venueId) => !state.cashierVenueIds.has(venueId));
  if (missingCashierNfc.length) {
    throw new Error(`${missingCashierNfc.length} managed Club Deals are missing an active cashier NFC sticker.`);
  }
  const supportedTitles = new Set(DEAL_TEMPLATES.map((template) => template.title));
  const unsupportedDeals = state.managedDeals.filter((deal) => !supportedTitles.has(deal.deal_title));
  if (unsupportedDeals.length) {
    throw new Error(`${unsupportedDeals.length} managed Club Deals are not Half-off admission or Skip the line.`);
  }
  return state.managedDeals;
}

function isManagedDeal(deal) {
  const rules = deal.redemption_rules;
  return rules?.demo_managed === true
    && rules?.managed_by === MANAGER_NAME
    && rules?.batch_version === BATCH_VERSION;
}

function publicDeal(row) {
  const venue = joined(row.venues);
  return {
    venueName: venue?.name || null,
    venueSlug: venue?.slug || null,
    title: row.deal_title,
    cashierNfcRequired: row.redemption_rules?.cashier_nfc_required === true,
    referralCommissionCents: row.payout_amount_cents,
  };
}

function joined(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
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
