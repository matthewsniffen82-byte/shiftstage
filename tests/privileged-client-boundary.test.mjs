import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const privilegedModules = [
  "src/lib/supabase/admin.ts",
  "src/lib/stripe.ts",
];

test("privileged service clients enforce a server-only module boundary", () => {
  for (const relativePath of privilegedModules) {
    const source = read(relativePath);
    assert.match(source, /^import "server-only";/, `${relativePath} must remain server-only`);
  }
});

test("client components cannot import privileged service clients", () => {
  const violations = sourceFiles(["app", "src"])
    .filter((relativePath) => /^\s*["']use client["'];/m.test(read(relativePath)))
    .filter((relativePath) => /src\/lib\/(?:supabase\/admin|stripe)/.test(read(relativePath)));

  assert.deepEqual(violations, []);
});

test("privileged server credentials cannot use a public environment prefix", () => {
  const violations = sourceFiles(["app", "src"])
    .filter((relativePath) => /NEXT_PUBLIC_(?:SUPABASE_SERVICE_ROLE|STRIPE_SECRET|STRIPE_WEBHOOK|CRON_SECRET)/.test(read(relativePath)));

  assert.deepEqual(violations, []);
});

function sourceFiles(roots) {
  return roots.flatMap((root) => walk(path.join(projectRoot, root)))
    .map((absolutePath) => path.relative(projectRoot, absolutePath).replaceAll("\\", "/"));
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}
