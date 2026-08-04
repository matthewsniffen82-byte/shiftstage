import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DATASET_MARKER = "mydancr-layout-review-v1";
const populationFlag = String(process.env.LAYOUT_REVIEW_POPULATE || "").trim();

if (!populationFlag) {
  console.log("LAYOUT_REVIEW_POPULATION_SKIPPED");
  process.exit(0);
}

if (populationFlag !== DATASET_MARKER) {
  throw new Error(
    `LAYOUT_REVIEW_POPULATE must exactly equal ${DATASET_MARKER} when enabled.`,
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
    "--apply",
    "--target=production",
    "--count=11",
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
