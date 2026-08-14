import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DATASET_MARKER = "mydancr-layout-review-v1";
const populationFlag = String(process.env.LAYOUT_REVIEW_POPULATE || "").trim();
const dealSyncFlag = String(process.env.LAYOUT_REVIEW_SYNC_DEALS || "").trim();
const scheduleSyncFlag = String(
  process.env.LAYOUT_REVIEW_SYNC_SCHEDULES || "",
).trim();
const upcomingSyncFlag = String(process.env.DEMO_UPCOMING_SYNC || "").trim();
const DEFAULT_UPCOMING_SYNC_FLAG = "mydancr-three-upcoming-v1";
const shouldSyncDefaultUpcoming =
  process.env.VERCEL_ENV === "production" &&
  !upcomingSyncFlag &&
  !populationFlag &&
  !dealSyncFlag &&
  !scheduleSyncFlag;
const shouldSyncUpcoming = Boolean(upcomingSyncFlag) || shouldSyncDefaultUpcoming;

if (shouldSyncUpcoming) {
  if (populationFlag || dealSyncFlag || scheduleSyncFlag) {
    throw new Error(
      "Demo Upcoming sync cannot run with another layout-review production operation.",
    );
  }
  if (upcomingSyncFlag && upcomingSyncFlag !== DEFAULT_UPCOMING_SYNC_FLAG) {
    throw new Error(
      `The Demo Upcoming sync flag must exactly equal ${DEFAULT_UPCOMING_SYNC_FLAG}.`,
    );
  }
  if (process.env.VERCEL_ENV !== "production") {
    throw new Error("Demo Upcoming sync is restricted to an explicit production build.");
  }

  const upcomingManagerPath = fileURLToPath(
    new URL("./manage-demo-upcoming.mjs", import.meta.url),
  );
  const upcomingResult = spawnSync(
    process.execPath,
    [
      upcomingManagerPath,
      "--mode=apply",
      "--target=production",
      "--confirm=mydancr-six-now-two-unscheduled-v1",
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (upcomingResult.error) throw upcomingResult.error;
  if (upcomingResult.status !== 0) {
    throw new Error(`Demo Upcoming sync exited with status ${upcomingResult.status}.`);
  }
  process.exit(0);
}

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
