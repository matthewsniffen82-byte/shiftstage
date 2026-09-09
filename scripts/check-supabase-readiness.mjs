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
  const [auth, schema, publicProfiles, legalNames, privateMetrics, savedDeals, storage] = await Promise.all([
    read("/auth/v1/health"), read("/rest/v1/", service),
    read("/rest/v1/dancer_profiles?select=id,stage_name&limit=0"),
    read("/rest/v1/dancer_profiles?select=real_name&limit=0"),
    read("/rest/v1/dancer_monthly_impact?select=dancer_id&limit=0"),
    read("/rest/v1/customer_deal_saves?select=customer_id&limit=0"),
    read("/storage/v1/bucket", service),
  ]);
  checks.push(...checkStorageBucketSecurity(storage.ok ? storage.data : null));
  checks.push({ name: "Auth service", ok: auth.ok }, { name: "Database schema", ok: schema.ok },
    { name: "Public profile projection", ok: publicProfiles.ok },
    ...[["Legal-name protection", legalNames], ["Private analytics protection", privateMetrics], ["Private saved-deal protection", savedDeals]]
      .map(([name, response]) => ({ name, ok: [401, 403].includes(response.status) && response.data?.code === "42501" })));
  for (const table of ["app_users", "dancer_profiles", "customer_profiles", "venues", "shifts", "support_threads", "support_messages", "notifications", "account_recovery_events", "customer_deal_saves"]) {
    checks.push({ name: `Schema: ${table}`, ok: Boolean(schema.data?.paths?.[`/${table}`]) });
  }
  for (const rpc of ["provision_app_account_safely", "transition_dancer_publication_safely", "create_support_message_safely", "get_ranking_metric_batch"]) {
    checks.push({ name: `Function: ${rpc}`, ok: Boolean(schema.data?.paths?.[`/rpc/${rpc}`]) });
  }
} catch {
  checks.push({ name: "Read-only provider checks completed", ok: false });
}
console.log(JSON.stringify({ ok: checks.every(check => check.ok), checks }, null, 2));
if (checks.some(check => !check.ok)) process.exitCode = 1;
