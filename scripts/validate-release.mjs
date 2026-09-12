import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertSupportedNodeRuntime } from "../src/lib/security/node-runtime.mjs";
import { validateRelease } from "./lib/release-validation.mjs";

assertSupportedNodeRuntime();
const cwd = fileURLToPath(new URL("../", import.meta.url));
const { packageManager } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const npmCli = process.env.npm_execpath;
if (!npmCli || !/^npm@\d+\.\d+\.\d+$/.test(packageManager)) {
  throw new Error("Run release validation through the packageManager-pinned npm.");
}
const npmVersion = execFileSync(process.execPath, [npmCli, "--version"], {
  encoding: "utf8", timeout: 15_000, windowsHide: true,
}).trim();
await validateRelease({
  npmCli, npmVersion, expectedNpmVersion: packageManager.slice(4),
  environment: process.env, cwd,
});
