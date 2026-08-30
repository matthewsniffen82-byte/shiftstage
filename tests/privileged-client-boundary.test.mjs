import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const privilegedModules = [
  "src/lib/server-env.ts",
  "src/lib/supabase/admin.ts",
  "src/lib/stripe.ts",
  "src/lib/dancr/account-recovery.ts",
  "src/lib/dancr/admin.ts",
  "src/lib/dancr/avatar-face.ts",
  "src/lib/dancr/cron-auth.ts",
  "src/lib/dancr/deal-attribution.ts",
  "src/lib/dancr/deal-campaign.ts",
  "src/lib/dancr/dmca.ts",
  "src/lib/dancr/image-moderation.ts",
  "src/lib/dancr/media-identity.ts",
  "src/lib/dancr/nats.ts",
  "src/lib/dancr/notification-delivery.ts",
  "src/lib/dancr/payout-provider.ts",
  "src/lib/dancr/public-request-rate-limit.ts",
  "src/lib/dancr/venue-affiliations.ts",
  "src/lib/dancr/venue-claims.ts",
  "src/lib/dancr/video-moderation.ts",
];
const privilegedModuleSet = new Set(privilegedModules);
const requiredServerEnvironmentVariables = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DANCR_ADMIN_SEED_KEY",
  "DANCR_MEDIA_IMPORT_KEY",
  "DANCR_ADMIN_SIGNUP_CODE",
  "CRON_SECRET",
  "DANCR_ACCOUNT_RECOVERY_SECRET",
  "DANCR_PUBLIC_RATE_LIMIT_SECRET",
  "DMCA_RATE_LIMIT_SALT",
  "VENUE_CLAIM_CODE_SECRET",
  "DANCER_VENUE_VERIFICATION_SECRET",
  "DANCR_IP_HASH_SECRET",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NATS_API_KEY",
  "ONESIGNAL_REST_API_KEY",
  "RESEND_API_KEY",
];

test("privileged service clients enforce a server-only module boundary", () => {
  for (const relativePath of privilegedModules) {
    const source = read(relativePath);
    assert.match(source, /^import "server-only";/, `${relativePath} must remain server-only`);
  }
});

test("client component import graphs cannot reach privileged server modules", () => {
  const violations = sourceFiles(["app", "src"])
    .filter((relativePath) => /^\s*["']use client["'];/m.test(read(relativePath)))
    .flatMap((relativePath) => {
      const pathToPrivilegedModule = findPrivilegedImportPath(relativePath);
      return pathToPrivilegedModule ? [pathToPrivilegedModule.join(" -> ")] : [];
    });

  assert.deepEqual(violations, []);
});

test("client components cannot read environment variables directly", () => {
  const violations = sourceFiles(["app", "src"])
    .filter((relativePath) => /^\s*["']use client["'];/m.test(read(relativePath)))
    .filter((relativePath) => /process\.env/.test(read(relativePath)));

  assert.deepEqual(violations, []);
});

test("public environment helpers cannot expose server environment access", () => {
  const publicEnvironment = read("src/lib/env.ts");
  const serverEnvironment = read("src/lib/server-env.ts");

  assert.doesNotMatch(publicEnvironment, /getServerEnv|getOptionalServerEnv|process\.env\[/);
  assert.match(serverEnvironment, /^import "server-only";/);
  assert.match(serverEnvironment, /process\.env\[name\]/);
});

test("the production environment contract names every privileged server variable", () => {
  const environmentExample = read(".env.example");
  for (const name of requiredServerEnvironmentVariables) {
    assert.match(environmentExample, new RegExp(`^${name}=`, "m"), `${name} must be documented`);
  }
});

test("every secret-bearing library module declares a server-only boundary", () => {
  const sensitiveReference = /\b(?:getServerEnv|getOptionalServerEnv)\(|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|OPENAI_API_KEY|RESEND_API_KEY|ONESIGNAL_REST_API_KEY|NATS_API_KEY|CRON_SECRET|DANCR_(?:ACCOUNT_RECOVERY_SECRET|PUBLIC_RATE_LIMIT_SECRET|IP_HASH_SECRET|MEDIA_IMPORT_KEY|ADMIN_SIGNUP_CODE|ADMIN_SEED_KEY)|DANCER_VENUE_VERIFICATION_SECRET|DMCA_RATE_LIMIT_SALT|VENUE_CLAIM_CODE_SECRET/;
  const violations = sourceFiles(["src/lib"])
    .filter((relativePath) => sensitiveReference.test(read(relativePath)))
    .filter((relativePath) => !read(relativePath).startsWith('import "server-only";'));

  assert.deepEqual(violations, []);
});

test("route handlers access privileged values only through server-only modules", () => {
  const directSecretRead = /process\.env\.(?:SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|OPENAI_API_KEY|RESEND_API_KEY|ONESIGNAL_REST_API_KEY|NATS_API_KEY|CRON_SECRET|DANCR_(?:ACCOUNT_RECOVERY_SECRET|PUBLIC_RATE_LIMIT_SECRET|IP_HASH_SECRET|MEDIA_IMPORT_KEY|ADMIN_SIGNUP_CODE|ADMIN_SEED_KEY)|DANCER_VENUE_VERIFICATION_SECRET|DMCA_RATE_LIMIT_SALT|VENUE_CLAIM_CODE_SECRET)/;
  const violations = sourceFiles(["app"])
    .filter((relativePath) => directSecretRead.test(read(relativePath)));

  assert.deepEqual(violations, []);
});

test("privileged server credentials cannot use a public environment prefix", () => {
  const violations = sourceFiles(["app", "src"])
    .filter((relativePath) => /NEXT_PUBLIC_(?:SUPABASE_SERVICE_ROLE|STRIPE_SECRET|STRIPE_WEBHOOK|CRON_SECRET|OPENAI_API_KEY|RESEND_API_KEY|ONESIGNAL_REST_API_KEY|NATS_API_KEY|DANCR_[A-Z0-9_]*SECRET)/.test(read(relativePath)));

  assert.deepEqual(violations, []);
});

function findPrivilegedImportPath(entryPath) {
  const visited = new Set();

  function visit(relativePath, ancestry) {
    if (privilegedModuleSet.has(relativePath)) return [...ancestry, relativePath];
    if (visited.has(relativePath)) return null;
    visited.add(relativePath);

    for (const importedPath of projectImports(relativePath)) {
      const result = visit(importedPath, [...ancestry, relativePath]);
      if (result) return result;
    }
    return null;
  }

  return visit(entryPath, []);
}

function projectImports(relativePath) {
  const source = read(relativePath);
  const specifiers = [
    ...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?(?:from\s*)?["']([^"']+)["'];/g),
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);

  return specifiers
    .map((specifier) => resolveProjectImport(relativePath, specifier))
    .filter(Boolean);
}

function resolveProjectImport(importerPath, specifier) {
  let candidate;
  if (specifier.startsWith("@/")) {
    candidate = path.join(projectRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    candidate = path.resolve(projectRoot, path.dirname(importerPath), specifier);
  } else {
    return null;
  }

  for (const absolutePath of moduleCandidates(candidate)) {
    if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
      return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
    }
  }
  return null;
}

function moduleCandidates(candidate) {
  if (path.extname(candidate)) return [candidate];
  return [
    candidate,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((extension) => `${candidate}${extension}`),
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((extension) => path.join(candidate, `index${extension}`)),
  ];
}

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
