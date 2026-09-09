import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function migrationDigest(sql) {
  return createHash("sha256").update(sql.replace(/\r\n?/g, "\n")).digest("hex");
}

function validTimestamp(version) {
  if (!/^\d{14}$/.test(version)) return false;
  const iso = `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}T${version.slice(8, 10)}:${version.slice(10, 12)}:${version.slice(12, 14)}Z`;
  const date = new Date(iso);
  return Number.isFinite(date.valueOf()) && date.toISOString().replace(/\D/g, "").slice(0, 14) === version;
}

/** Filesystem-only check. A pass does not authorize SQL execution or ledger repair. */
export async function verifyMigrationHistory(directory, baseline) {
  if (baseline.format !== 1 || !Array.isArray(baseline.files) || baseline.files.length === 0) {
    throw new Error("Missing migration history baseline. Do not regenerate it to hide a failure.");
  }
  const historical = new Map();
  for (const entry of baseline.files) {
    if (!/^(?:\d{12}|\d{14})_[a-z0-9_]+\.sql$/.test(entry.file)
        || !/^[a-f0-9]{64}$/.test(entry.sha256) || historical.has(entry.file)) {
      throw new Error("Invalid migration history baseline entry.");
    }
    historical.set(entry.file, entry.sha256);
  }
  const lastHistoricalVersion = [...historical.keys()].map(file => file.split("_")[0]).sort().at(-1);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => /\.sql$/i.test(entry.name));
  const present = new Set(files.map(entry => entry.name));
  const errors = [];
  for (const name of historical.keys()) {
    if (!present.has(name)) errors.push(`Historical migration missing or renamed: ${name}`);
  }
  const groups = new Map();
  for (const entry of files) {
    const name = entry.name;
    if (!entry.isFile()) { errors.push(`Migration must be a regular file: ${name}`); continue; }
    if (!/^(?:\d{12}|\d{14})_[a-z0-9_]+\.sql$/.test(name)) {
      errors.push(`Invalid migration filename: ${name}`); continue;
    }
    const version = name.split("_")[0];
    groups.set(version, [...(groups.get(version) || []), name]);
    const sql = await readFile(join(directory, name), "utf8");
    if (historical.has(name)) {
      if (migrationDigest(sql) !== historical.get(name)) errors.push(`Historical SQL changed: ${name}. Add a new migration instead.`);
    } else {
      if (!validTimestamp(version)) errors.push(`New migrations require a valid UTC YYYYMMDDHHMMSS version: ${name}`);
      if (version <= lastHistoricalVersion) errors.push(`New migration sorts into historical history: ${name}`);
      if (!sql.trim()) errors.push(`Empty migration: ${name}`);
    }
  }
  const historicalCollisions = [];
  for (const [version, names] of groups) {
    if (names.length < 2) continue;
    if (names.every(name => historical.has(name))) historicalCollisions.push({ version, files: names.sort() });
    else errors.push(`Duplicate migration version ${version}: ${names.sort().join(", ")}`);
  }
  return { ok: errors.length === 0, files: files.length, historicalFiles: historical.size,
    newFiles: files.filter(entry => !historical.has(entry.name)).length, historicalCollisions, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const baseline = JSON.parse(await readFile(join(root, "supabase/migration-history-baseline.json"), "utf8"));
    const report = await verifyMigrationHistory(join(root, "supabase/migrations"), baseline);
    console.log(JSON.stringify({ ...report,
      replayReady: false,
      note: "Historical version collisions remain quarantined. This check never applies SQL or repairs a remote ledger. See docs/supabase-reliability/migration-safety.md." }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Migration history check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
