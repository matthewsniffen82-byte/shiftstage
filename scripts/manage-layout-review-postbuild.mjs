import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DATASET_MARKER = "mydancr-layout-review-v1";
const populationFlag = String(process.env.LAYOUT_REVIEW_POPULATE || "").trim();
const dealSyncFlag = String(process.env.LAYOUT_REVIEW_SYNC_DEALS || "").trim();
const scheduleSyncFlag = String(
  process.env.LAYOUT_REVIEW_SYNC_SCHEDULES || "",
).trim();

if (!populationFlag && !dealSyncFlag && !scheduleSyncFlag) {
  console.log("LAYOUT_REVIEW_POPULATION_SKIPPED");
  process.exit(0);
}

const enabledFlags = [populationFlag, dealSyncFlag, scheduleSyncFlag].filter(Boolean);
if (enabledFlags.length !== 1) {
  throw new Error(
    "Choose exactly one layout-review population, deal-sync, or schedule-sync operation.",
  );
}

const [enabledFlag] = enabledFlags;
if (enabledFlag !== DATASET_MARKER) {
  throw new Error(
    `The enabled layout-review operation must exactly equal ${DATASET_MARKER}.`,
  );
}

if (process.env.VERCEL_ENV !== "production") {
  throw new Error("Layout-review population is restricted to an explicit production build.");
}

const managerPath = fileURLToPath(
  new URL("./manage-layout-review-profiles.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    managerPath,
    dealSyncFlag
      ? "--sync-deals"
      : scheduleSyncFlag
        ? "--sync-schedules"
        : "--apply",
    "--target=production",
    "--count=10",
    `--confirm=${DATASET_MARKER}`,
  ],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Layout-review population exited with status ${result.status}.`);
}
