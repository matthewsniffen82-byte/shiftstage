import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { parseSourceReconciliationOptions, reconcileGallerySources } from "./lib/gallery-source-reconciliation.mjs";

// No scheduled execution. A dry run is the default; apply requires its exact
// record and fingerprint. Output contains no storage paths or account details.
try {
  const options = parseSourceReconciliationOptions(process.argv.slice(2));
  nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Maintenance credentials are missing.");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) }) },
  });
  const report = await reconcileGallerySources(client, options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch {
  // Provider exceptions can include URLs, account details or credentials.
  console.error(JSON.stringify({ ok: false, error: "Gallery source verification failed. Check the maintenance options, server credentials and provider availability; no cleanup is confirmed by this error." }));
  process.exitCode = 1;
}
