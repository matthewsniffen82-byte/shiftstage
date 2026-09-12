import { spawn } from "node:child_process";

// Preserve only operating-system discovery and temporary-directory settings for
// checks. In particular, provider credentials, NODE_OPTIONS, npm bypass options,
// maintenance flags and optional baseline-test flags must not reach test code.
const CHECK_ENVIRONMENT_NAMES = new Set([
  "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH",
]);

export function releaseCheckEnvironment(environment) {
  const safe = Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    CHECK_ENVIRONMENT_NAMES.has(name.toUpperCase()) && typeof value === "string"));
  return {
    ...safe,
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: "https://release-check.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic_release_check_only",
    npm_config_ignore_scripts: "false",
  };
}

export function runReleaseCommand({ label, executable, args, cwd, env }) {
  console.log(`RELEASE_CHECK_START ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, env, shell: false, windowsHide: true, stdio: "inherit", timeout: 25 * 60_000,
    });
    child.once("error", () => reject(new Error(`Release validation could not start: ${label}`)));
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal) reject(new Error(`Release validation failed: ${label}`));
      else { console.log(`RELEASE_CHECK_PASS ${label}`); resolve(); }
    });
  });
}

export async function validateRelease({
  npmCli, npmVersion, expectedNpmVersion, environment, cwd,
  executable = process.execPath, run = runReleaseCommand,
}) {
  if (!npmCli || npmVersion !== expectedNpmVersion) {
    throw new Error("Release validation requires the packageManager-pinned npm version.");
  }
  const checkEnv = releaseCheckEnvironment(environment);
  const commands = [
    ["dependency audit", [npmCli, "audit", "--audit-level=low", "--ignore-scripts"]],
    ["registry signatures", [npmCli, "audit", "signatures", "--ignore-scripts"]],
    ["runtime and generated assets", [npmCli, "run", "pretest"]],
    ["complete automated suite", ["--test", "--test-reporter=tap", "--test-concurrency=2", "tests/*.test.mjs"]],
    ["route type generation", ["node_modules/next/dist/bin/next", "typegen"]],
    ["standalone TypeScript", ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]],
    ["complete lint", ["node_modules/eslint/bin/eslint.js", ".", "--max-warnings=0"]],
  ];
  for (const [label, args] of commands) {
    await run({ label, executable, args, cwd, env: { ...checkEnv } });
  }
  // Only the final build receives the deployment environment. Its existing
  // configuration checks, migration guard and explicit maintenance rules remain
  // authoritative; checks above never enable those maintenance operations.
  await run({
    label: "production build", executable, args: [npmCli, "run", "build"], cwd,
    env: {
      ...Object.fromEntries(Object.entries(environment).filter(([name]) =>
        name.toLowerCase() !== "npm_config_ignore_scripts")),
      npm_config_ignore_scripts: "false",
    },
  });
}
