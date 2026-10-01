import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { releaseCheckEnvironment } from "./lib/release-validation.mjs";

export const stabilityTests = [
  "tests/finance-worker-budget.test.mjs",
  "tests/finance-statements-boundary.test.mjs",
  "tests/finance-cron-results.test.mjs",
  "tests/internal-alert-recovery-postgres.test.mjs",
  "tests/internal-request-push.test.mjs",
  "tests/internal-worker-budget.test.mjs",
  "tests/internal-request-cancellation-push.test.mjs",
  "tests/internal-roster-api.test.mjs",
  "tests/internal-full-profile.test.mjs",
  "tests/request-auth-availability.test.mjs",
  "tests/supabase-outage-reliability.test.mjs",
  "tests/supabase-response-byte-budget.test.mjs",
  "tests/server-job-deadline.test.mjs",
  "tests/stripe-webhook-delivery.test.mjs",
  "tests/payment-webhook-attempt-postgres.test.mjs",
  "tests/ondato-webhook.test.mjs",
  "tests/dashboard-module-boundaries.test.mjs",
  "tests/release-validation.test.mjs",
  "tests/stability-workflow.test.mjs",
];

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = releaseCheckEnvironment(process.env);
  for (const args of [
    ["scripts/check-runtime-dependencies.mjs"],
    ["scripts/generate-live-shell.mjs", "--check"],
    ["scripts/check-supabase-migrations.mjs"],
    ["--test", "--test-concurrency=2", ...stabilityTests],
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: "inherit", env, windowsHide: true });
    if (result.error || result.status !== 0) {
      process.exitCode = 1;
      break;
    }
  }
}
