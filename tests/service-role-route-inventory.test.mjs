import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const publicServiceRoleRoutes = new Set([
  "app/api/account-recovery/route.ts",
  "app/api/auth/route.ts",
  "app/api/customer/going/route.ts",
  "app/api/deals/redeem/[token]/route.ts",
  "app/api/deals/redemptions/[token]/events/route.ts",
  "app/api/dmca/notices/route.ts",
  "app/api/events/route.ts",
  "app/api/health/supabase/route.ts",
  "app/api/nfc/[token]/route.ts",
  "app/api/reports/route.ts",
  "app/api/venue/access-code/preview/route.ts",
  "app/api/venue/signup-requests/route.ts",
]);

const serviceRoleRoutes = walk(path.join(projectRoot, "app", "api"))
  .map(relative)
  .filter((routePath) => routePath.endsWith("/route.ts"))
  .filter((routePath) => read(routePath).includes("createAdminSupabaseClient"));

test("every service-role API route has an explicit reviewed trust boundary", () => {
  const unclassified = serviceRoleRoutes.filter((routePath) => {
    const source = read(routePath);

    if (routePath.startsWith("app/api/admin/")) {
      if (routePath === "app/api/admin/avatars/recenter/route.ts"
        || routePath === "app/api/admin/tv/import/route.ts") {
        return !/timingSafeEqual/.test(source) || !/authorize\w*Request\(request\)/.test(source);
      }
      return !/requireAdmin\(/.test(source);
    }

    if (routePath.startsWith("app/api/cron/")) {
      return !guardPrecedesServiceClient(source, "authorizeCronRequest(request)");
    }

    if (routePath === "app/api/stripe/webhook/route.ts") {
      return !/webhooks\.constructEvent\(/.test(source);
    }

    if (routePath.startsWith("app/api/public/") || publicServiceRoleRoutes.has(routePath)) {
      return false;
    }

    return !/createRequestSupabaseContext\(request\)/.test(source);
  });

  assert.deepEqual(unclassified, []);
});

test("reviewed public exceptions still exist and still use the service-role client", () => {
  for (const routePath of publicServiceRoleRoutes) {
    assert.ok(serviceRoleRoutes.includes(routePath), `${routePath} must be re-reviewed if removed or renamed`);
  }
});

test("scheduled workers authorize before constructing a service-role client", () => {
  const cronRoutes = serviceRoleRoutes.filter((routePath) => routePath.startsWith("app/api/cron/"));
  assert.ok(cronRoutes.length > 0);
  for (const routePath of cronRoutes) {
    assert.equal(
      guardPrecedesServiceClient(read(routePath), "authorizeCronRequest(request)"),
      true,
      `${routePath} must authenticate before privileged work`,
    );
  }
});

function guardPrecedesServiceClient(source, guard) {
  const guardIndex = source.indexOf(guard);
  const clientIndex = source.indexOf("createAdminSupabaseClient()", guardIndex + guard.length);
  return guardIndex >= 0 && clientIndex > guardIndex;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function relative(absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}
