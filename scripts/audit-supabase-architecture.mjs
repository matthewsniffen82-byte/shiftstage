import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = process.argv[2];
const outputPath = process.argv[3];
if (!catalogPath || !outputPath) throw new Error("Usage: node scripts/audit-supabase-architecture.mjs <read-only catalog.json> <output.json>");
const catalog = JSON.parse(await readFile(resolve(catalogPath), "utf8"));
if (catalog.read_only !== "on" || !Array.isArray(catalog.relations) || !Array.isArray(catalog.migrations)) {
  throw new Error("A complete read-only metadata capture is required.");
}
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sources = tracked.filter(file => /^(app|src|scripts|supabase)\//.test(file) || file === "outputs/index.html" || file === "middleware.ts" || file === "next.config.mjs" || file === "vercel.json");
const files = [];
const migrations = [];
const lineAt = (text, index) => text.slice(0, index).split("\n").length;
const hash = text => createHash("sha256").update(text).digest("hex");
for (const file of sources) {
  if (!/\.(?:ts|tsx|mjs|js|sql|html|json)$/.test(file)) continue;
  const source = await readFile(resolve(root, file), "utf8");
  if (file.startsWith("supabase/migrations/")) {
    const name = file.split("/").at(-1);
    migrations.push({ file, version: name.split("_")[0], sha256: hash(source.replace(/\r\n/g, "\n")),
      statements: ["create table", "alter table", "drop table", "delete from", "update ", "create policy", "drop policy", "create or replace function"].filter(pattern => source.toLowerCase().includes(pattern)) });
    continue;
  }
  const calls = [];
  for (const match of source.matchAll(/\.(from|rpc)\(\s*["'`]([\w-]+)["'`]/g)) {
    calls.push({ kind: match[1], name: match[2], line: lineAt(source, match.index) });
  }
  const auth = [...source.matchAll(/\.auth\.(?:admin\.)?([A-Za-z]+)\(/g)].map(match => ({ method: match[1], line: lineAt(source, match.index) }));
  const environment = [...new Set([...source.matchAll(/(?:process\.env\.|(?:getServerEnv|getOptionalServerEnv)\(["'])([A-Z][A-Z0-9_]+)/g)].map(match => match[1]))].sort();
  const realtime = [...source.matchAll(/\.(channel|subscribe|removeChannel|unsubscribe)\(|["']postgres_changes["']/g)].map(match => ({ line: lineAt(source, match.index), operation: match[1] || "postgres_changes" }));
  const clients = [...source.matchAll(/(?:createAdminSupabaseClient|createServerSupabaseClient|createBrowserSupabaseClient|createRequestSupabaseContext|createClient)\(/g)].map(match => ({ line: lineAt(source, match.index), factory: match[0].slice(0, -1) }));
  const dynamic = [...source.matchAll(/\.(from|rpc)\(\s*([A-Za-z_$][\w.$]*)\s*[,)]/g)].map(match => ({ line: lineAt(source, match.index), kind: match[1], expression: match[2] }));
  if (calls.length || auth.length || environment.length || realtime.length || clients.length || dynamic.length || /supabase|browser-session|dashboard-session/.test(source)) {
    files.push({ file, browserEntry: /^["']use client["']/m.test(source), calls, dynamic, auth, environment, realtime, clients });
  }
}
const migrationGroups = Object.groupBy(migrations, migration => migration.version);
const publicRelations = catalog.relations.filter(relation => relation.schema_name === "public");
const tableDependencies = publicRelations.map(relation => ({ table: relation.name, kind: relation.kind,
  directConsumers: files.filter(file => file.calls.some(call => call.kind === "from" && call.name === relation.name)).map(file => file.file),
  columns: catalog.columns.filter(column => column.table_schema === "public" && column.table_name === relation.name).length,
  policies: catalog.policies.filter(policy => policy.schemaname === "public" && policy.tablename === relation.name).length,
  foreignKeys: catalog.constraints.filter(constraint => constraint.schema_name === "public" && constraint.table_name === relation.name && constraint.type === "f").map(constraint => ({ name: constraint.name, references: constraint.referenced_table, deleteAction: constraint.delete_action })),
}));
const recorded = new Set(catalog.migrations.map(migration => migration.version));
const result = { baseline, capturedAt: catalog.captured_at,
  scope: "Catalog metadata plus textual references in tracked application/server/migration sources. Dynamic names, SQL consumers and module call paths require review; no-reference entries are not proof of unused data.",
  counts: { trackedFiles: tracked.length, integrationFiles: files.length, migrations: migrations.length, migrationVersions: Object.keys(migrationGroups).length, publicRelations: publicRelations.length },
  migrations: { files: migrations, duplicateVersions: Object.entries(migrationGroups).filter(([, group]) => group.length > 1).map(([version, group]) => ({ version, files: group.map(migration => migration.file) })),
    unrecordedFiles: migrations.filter(migration => !recorded.has(migration.version)).map(migration => migration.file),
    remoteOnly: catalog.migrations.filter(migration => !migrationGroups[migration.version]) },
  files, tableDependencies, catalog };
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(resolve(outputPath), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ baseline, ...result.counts, duplicateVersions: result.migrations.duplicateVersions.length, unrecordedFiles: result.migrations.unrecordedFiles.length, remoteOnly: result.migrations.remoteOnly.length }));
