import { checkStorageBucketSecurity } from "../../src/lib/security/storage-bucket-policy.mjs";

const canonical = value => JSON.stringify(value, (_key, child) =>
  child && typeof child === "object" && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]]))
    : child);

function sameRows(actual, expected, key, fields) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  const project = rows => rows.map(row => {
    if (!row || typeof row !== "object" || fields.some(field => !(field in row))) throw new Error("Invalid metadata");
    return [key(row), canonical(Object.fromEntries(fields.map(field => [field, row[field]])))];
  }).sort(([left], [right]) => left.localeCompare(right));
  try {
    const left = project(actual), right = project(expected);
    if (new Set(left.map(([id]) => id)).size !== left.length) return false;
    return canonical(left) === canonical(right);
  } catch {
    return false;
  }
}

// Compare metadata exported by catalog-read-only.sql with the reviewed runtime
// fixtures. This never connects to a provider or evaluates SQL/function bodies.
// A new table or changed policy requires review even when access became stricter.
// Column ACLs, role memberships and non-CRUD grants need their separate SQL gate.
export function reviewSupabaseAccessCatalog(catalog, { publicAccess, storageAccess }) {
  const checks = [];
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  add("Read-only metadata receipt", catalog?.read_only === "on" &&
    typeof catalog.captured_at === "string" && Number.isFinite(Date.parse(catalog.captured_at)));
  const select = (field, schemaField, schema) => Array.isArray(catalog?.[field])
    ? catalog[field].filter(row => row?.[schemaField] === schema) : null;
  for (const [schema, expected] of [["public", publicAccess], ["storage", storageAccess]]) {
    add(`${schema} relations, row security and CRUD grants`, sameRows(
      select("relations", "schema_name", schema), expected.relations.filter(row => row.schema_name === schema),
      row => row.name, ["schema_name", "name", "kind", "owner", "rls", "force_rls", "options", "grants"]));
    add(`${schema} policies`, sameRows(
      select("policies", "schemaname", schema), expected.policies.filter(row => row.schemaname === schema),
      row => `${row.tablename}.${row.policyname}`, ["schemaname", "tablename", "policyname", "permissive", "roles", "cmd", "qual", "with_check"]));
    add(`${schema} views`, sameRows(
      select("views", "schemaname", schema), expected.views.filter(row => row.schemaname === schema),
      row => row.viewname, ["schemaname", "viewname", "definition"]));
  }
  for (const helper of publicAccess.helpers) {
    const matching = select("functions", "schema_name", "public")?.filter(fn => fn.name === helper.name && fn.arguments === "");
    add(`Policy helper: ${helper.name}`, matching?.length === 1 && matching[0].definition_fingerprint === helper.fingerprint);
  }
  checks.push(...checkStorageBucketSecurity(catalog?.buckets));
  return { ok: checks.every(check => check.ok), capturedAt: checks[0].ok ? catalog.captured_at : null, checks };
}
