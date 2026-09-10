import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { auditGalleryStorage, galleryAuditFetch, parseGalleryStorageAuditOptions } from "./lib/gallery-storage-audit.mjs";

try {
  const options = parseGalleryStorageAuditOptions(process.argv.slice(2));
  nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Maintenance credentials are missing.");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: galleryAuditFetch(url) },
  });
  const report = await auditGalleryStorage(client, options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch {
  // Never print account details, storage paths, credentials or provider errors.
  console.error(JSON.stringify({ ok: false, error: "Gallery storage audit failed. Check the profile, options, server credentials and provider availability. This command does not modify data." }));
  process.exitCode = 1;
}
