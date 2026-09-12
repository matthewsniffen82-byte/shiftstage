import { validatePublicSupabaseConfig } from "../src/lib/supabase/public-config.mjs";
import { checkStorageBucketSecurity } from "../src/lib/security/storage-bucket-policy.mjs";

// Read-only release verification. Run on the server/CLI, never in a browser.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
validatePublicSupabaseConfig(url, anon);
if (!service) throw new Error("Server credentials are required for the read-only schema check.");

async function read(path, key = anon) {
  const response = await fetch(`${url}${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000), cache: "no-store",
  });
  return { status: response.status, ok: response.ok, data: await response.json().catch(() => null) };
}

const checks = [];
try {
  const [auth, schema, publicProfiles, legalNames, privateMetrics, savedDeals, storage, publicDeals, privateDealFields, publicShifts, shiftCoordinates, internalShiftFields, privateAccountPauses, publicVenues, privateVenueFields, privateDmcaStates] = await Promise.all([
    read("/auth/v1/health"), read("/rest/v1/", service),
    read("/rest/v1/dancer_profiles?select=id,stage_name&limit=0"),
    read("/rest/v1/dancer_profiles?select=real_name&limit=0"),
    read("/rest/v1/dancer_monthly_impact?select=dancer_id&limit=0"),
    read("/rest/v1/customer_deal_saves?select=customer_id&limit=0"),
    read("/storage/v1/bucket", service),
    read("/rest/v1/club_deals?select=id,venue_id,deal_title,deal_description,deal_terms,is_active,valid_days,valid_start_time,valid_end_time,offer_type,booking_url,sort_order&limit=0"),
    read("/rest/v1/club_deals?select=payout_amount_cents,redemption_rules&limit=0"),
    read("/rest/v1/shifts?select=id,dancer_id,venue_id,starts_at,ends_at,timezone,status,location_status,checked_in_at,checked_out_at,location_verification_expires_at,shift_date,shift_source&limit=0"),
    read("/rest/v1/shifts?select=checkin_latitude,checkin_longitude,last_location_latitude,last_location_longitude,checkout_latitude,checkout_longitude&limit=0"),
    read("/rest/v1/shifts?select=created_at,updated_at,checkin_distance_feet,last_location_verified_at,working_status,venue_affiliation_id,nfc_tag_id,nfc_last_tapped_at&limit=0"),
    read("/rest/v1/account_self_pauses?select=user_id&limit=0"),
    read("/rest/v1/venues?select=id,name,slug,city,state,address,phone,website,timezone,opens_at,closes_at,is_active,latitude,longitude,cover_image_storage_path,cover_image_updated_at,published_at,logo_storage_path,logo_updated_at,owner_user_id&limit=0"),
    read("/rest/v1/venues?select=page_review_notes,page_reviewed_by_user_id,qr_code_label&limit=0"),
    read("/rest/v1/dmca_enforcement_states?select=target_type,target_id&limit=0"),
  ]);
  checks.push(...checkStorageBucketSecurity(storage.ok ? storage.data : null));
  checks.push({ name: "Public venue projection", ok: publicVenues.ok },
    { name: "Internal venue fields protected", ok: [401, 403].includes(privateVenueFields.status) && privateVenueFields.data?.code === "42501" });
  checks.push({ name: "Public deal projection", ok: publicDeals.ok },
    { name: "Private deal fields protected", ok: [401, 403].includes(privateDealFields.status) && privateDealFields.data?.code === "42501" });
  checks.push({ name: "Public schedule projection", ok: publicShifts.ok },
    ...[["Raw shift coordinates protected", shiftCoordinates], ["Internal shift details protected", internalShiftFields], ["Private account pauses protected", privateAccountPauses], ["Private copyright ownership protected", privateDmcaStates]]
      .map(([name, result]) => ({ name, ok: [401, 403].includes(result.status) && result.data?.code === "42501" })));
  checks.push({ name: "Auth service", ok: auth.ok }, { name: "Database schema", ok: schema.ok },
    { name: "Public profile projection", ok: publicProfiles.ok },
    ...[["Legal-name protection", legalNames], ["Private analytics protection", privateMetrics], ["Private saved-deal protection", savedDeals]]
      .map(([name, response]) => ({ name, ok: [401, 403].includes(response.status) && response.data?.code === "42501" })));
  for (const table of ["app_users", "dancer_profiles", "customer_profiles", "venues", "shifts", "support_threads", "support_messages", "notifications", "account_recovery_events", "customer_deal_saves", "dmca_cases", "dmca_counter_notices", "dmca_strikes", "dmca_enforcement_states"]) {
    checks.push({ name: `Schema: ${table}`, ok: Boolean(schema.data?.paths?.[`/${table}`]) });
  }
  for (const rpc of ["consume_request_rate_limit", "provision_app_account_safely", "transition_dancer_publication_safely", "transition_own_account_safely", "change_venue_publication_safely", "create_support_message_safely", "get_ranking_metric_batch", "apply_dmca_takedown", "restore_dmca_case", "submit_dmca_counter_notice_safely", "transition_dmca_admin_case", "confirm_dmca_counter_forwarding"]) {
    checks.push({ name: `Function: ${rpc}`, ok: Boolean(schema.data?.paths?.[`/rpc/${rpc}`]) });
  }
} catch {
  checks.push({ name: "Read-only provider checks completed", ok: false });
}
console.log(JSON.stringify({ ok: checks.every(check => check.ok), checks }, null, 2));
if (checks.some(check => !check.ok)) process.exitCode = 1;
