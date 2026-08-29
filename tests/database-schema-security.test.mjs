import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationDirectory = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrations = migrationFiles
  .map((name) => readFileSync(path.join(migrationDirectory, name), "utf8"))
  .join("\n");

test("every retained public application table enables row-level security", () => {
  const created = captures(
    migrations,
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  );
  const protectedTables = captures(
    migrations,
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi,
  );
  const dropped = captures(
    migrations,
    /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  );
  const missing = [...created].filter((table) => !protectedTables.has(table) && !dropped.has(table));

  assert.deepEqual(missing, []);
});

test("every security-definer function fixes its search path", () => {
  const violations = [];
  for (const name of migrationFiles) {
    const source = readFileSync(path.join(migrationDirectory, name), "utf8");
    for (const match of source.matchAll(/security\s+definer/gi)) {
      const definitionTail = source.slice(match.index, match.index + 350);
      if (!/set\s+search_path\s*=/i.test(definitionTail)) {
        violations.push(`${name}:${lineNumber(source, match.index)}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("future public-schema objects default to least privilege", () => {
  const hardening = readFileSync(
    path.join(migrationDirectory, "202608280001_secure_public_schema_defaults.sql"),
    "utf8",
  );

  assert.match(hardening, /revoke create on schema public from public, anon, authenticated/i);
  assert.match(hardening, /revoke all privileges on tables from anon, authenticated/i);
  assert.match(hardening, /revoke all privileges on sequences from anon, authenticated/i);
  assert.match(hardening, /revoke execute on functions from public, anon, authenticated/i);
});

function captures(source, pattern) {
  return new Set([...source.matchAll(pattern)].map((match) => match[1].toLowerCase()));
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}
