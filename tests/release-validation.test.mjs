import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { releaseCheckEnvironment, runReleaseCommand, validateRelease } from "../scripts/lib/release-validation.mjs";

const environment = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-credential",
  STRIPE_SECRET_KEY: "synthetic-payment-credential",
  OPENAI_API_KEY: "synthetic-provider-credential",
  NEW_FUTURE_PROVIDER_CREDENTIAL: "synthetic-unknown-credential",
  NODE_OPTIONS: "--require=untrusted-preload.cjs",
  npm_config_ignore_scripts: "true",
  LAYOUT_REVIEW_POPULATE: "1", LAYOUT_REVIEW_SYNC_DEALS: "1",
  LAYOUT_REVIEW_SYNC_SCHEDULES: "1", DEMO_UPCOMING_SYNC: "1",
  DANCR_TEST_BASELINE: "1", VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://production.example.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "production-public-key",
};
const options = {
  npmCli: "pinned-npm-cli.js", npmVersion: "11.19.1", expectedNpmVersion: "11.19.1",
  environment, cwd: process.cwd(),
};

for (const name of [
  "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "OPENAI_API_KEY",
  "NEW_FUTURE_PROVIDER_CREDENTIAL", "NODE_OPTIONS", "LAYOUT_REVIEW_POPULATE",
  "LAYOUT_REVIEW_SYNC_DEALS", "LAYOUT_REVIEW_SYNC_SCHEDULES", "DEMO_UPCOMING_SYNC",
  "DANCR_TEST_BASELINE", "VERCEL_ENV",
]) {
  test(`checks exclude inherited ${name}`, () => {
    assert.equal(Object.hasOwn(releaseCheckEnvironment(environment), name), false);
  });
}

test("check configuration is synthetic and cannot disable npm lifecycle checks", () => {
  const safe = releaseCheckEnvironment(environment);
  assert.equal(safe.NEXT_PUBLIC_SUPABASE_URL, "https://release-check.invalid");
  assert.equal(safe.NEXT_PUBLIC_SUPABASE_ANON_KEY, "sb_publishable_synthetic_release_check_only");
  assert.equal(safe.npm_config_ignore_scripts, "false");
  assert.equal(safe.PATH, environment.PATH);
  assert.equal(environment.npm_config_ignore_scripts, "true");
});

test("actual child receives only check configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dancr-release-check-"));
  const output = join(directory, "environment.json");
  try {
    await runReleaseCommand({
      label: "synthetic environment probe", executable: process.execPath,
      args: ["--input-type=module", "-e", "import{writeFileSync}from'node:fs';writeFileSync(process.argv[1],JSON.stringify(process.env))", output],
      cwd: directory, env: releaseCheckEnvironment(environment),
    });
    const actual = JSON.parse(await readFile(output, "utf8"));
    assert.equal(actual.NEXT_PUBLIC_SUPABASE_URL, "https://release-check.invalid");
    for (const value of Object.values(actual)) assert.doesNotMatch(value, /synthetic-(?:server|payment|provider|unknown)-credential/);
    assert.equal(actual.NODE_OPTIONS, undefined);
    assert.equal(actual.DEMO_UPCOMING_SYNC, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an actual failing child is rejected", async () => {
  await assert.rejects(runReleaseCommand({
    label: "synthetic failed gate", executable: process.execPath,
    args: ["-e", "process.exit(12)"], cwd: process.cwd(), env: releaseCheckEnvironment(environment),
  }), /Release validation failed: synthetic failed gate/);
});

for (let failedGate = 0; failedGate < 8; failedGate++) {
  test(`failure at release gate ${failedGate + 1} prevents every later gate`, async () => {
    const calls = [];
    await assert.rejects(validateRelease({ ...options, run: async (command) => {
      calls.push(command);
      if (calls.length === failedGate + 1) throw new Error("synthetic failure");
    } }), /synthetic failure/);
    assert.equal(calls.length, failedGate + 1);
    if (failedGate < 7) assert.equal(calls.some(({ label }) => label === "production build"), false);
  });
}

test("only a successful check sequence reaches the real build environment", async () => {
  const calls = [];
  await validateRelease({ ...options, run: async (command) => { calls.push(command); } });
  assert.equal(calls.length, 8);
  const checks = calls.slice(0, -1);
  for (const command of checks) {
    assert.equal(command.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(command.env.DEMO_UPCOMING_SYNC, undefined);
  }
  const build = calls.at(-1);
  assert.equal(build.label, "production build");
  assert.equal(build.env.SUPABASE_SERVICE_ROLE_KEY, environment.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(build.env.DEMO_UPCOMING_SYNC, "1");
  assert.equal(build.env.npm_config_ignore_scripts, "false");
  assert.deepEqual(build.args, [options.npmCli, "run", "build"]);
  assert.equal(calls.findIndex(({ label }) => label === "route type generation") < calls.findIndex(({ label }) => label === "standalone TypeScript"), true);
});

test("case variants cannot bypass the build lifecycle checks on Windows", async () => {
  const calls = [];
  await validateRelease({ ...options,
    environment: { ...environment, NPM_CONFIG_IGNORE_SCRIPTS: "true" },
    run: async (command) => { calls.push(command); },
  });
  for (const { env } of calls) {
    assert.deepEqual(Object.keys(env).filter((name) => name.toLowerCase() === "npm_config_ignore_scripts"), ["npm_config_ignore_scripts"]);
    assert.equal(env.npm_config_ignore_scripts, "false");
  }
});

for (const override of [{ npmCli: "" }, { npmVersion: "11.19.0" }, { npmVersion: "11.19.1-beta" }]) {
  test(`invalid npm selection cannot start release checks: ${JSON.stringify(override)}`, async () => {
    let called = false;
    await assert.rejects(validateRelease({ ...options, ...override, run: async () => { called = true; } }), /pinned npm/);
    assert.equal(called, false);
  });
}
