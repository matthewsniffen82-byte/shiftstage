import { readFileSync } from "node:fs";
import { reviewSupabaseAccessCatalog } from "./lib/supabase-access-review.mjs";

try {
  if (process.argv.length !== 3) throw new Error("Expected one metadata export");
  const read = file => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const exported = read(process.argv[2]);
  const catalog = exported.rows
    ? (exported.rows.length === 1 ? exported.rows[0].catalog : null)
    : exported.catalog || exported;
  const publicAccess = read(new URL("../tests/fixtures/rls-current-access.json", import.meta.url));
  const storageAccess = read(new URL("../docs/supabase-reliability/step-01-inventory.json", import.meta.url)).catalog;
  const result = reviewSupabaseAccessCatalog(catalog, { publicAccess, storageAccess });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch {
  // Do not echo raw catalog contents, filesystem paths or parser diagnostics.
  console.error(JSON.stringify({ ok: false, error: "A valid metadata export is required. Run: node scripts/check-supabase-access.mjs <catalog.json>" }));
  process.exitCode = 1;
}
