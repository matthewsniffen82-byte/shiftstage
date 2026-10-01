import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const packageLock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const npmrc = readFileSync(new URL("../.npmrc", import.meta.url), "utf8");
const vercel = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);

const PINNED_NPM = "11.19.1";

test("brace expansion stays above the reviewed denial-of-service fixes", () => {
  assert.equal(packageJson.overrides["brace-expansion"], "^5.0.12");
  const entries = Object.entries(packageLock.packages).filter(([path]) => path.endsWith("node_modules/brace-expansion"));
  assert.ok(entries.length > 0);
  for (const [, metadata] of entries) {
    const [major, minor, patch] = metadata.version.split(".").map(Number);
    assert.ok(major === 5 && (minor > 0 || patch >= 12), `Review brace-expansion ${metadata.version}`);
  }
  // Run hostile nesting in a disposable child with a hard deadline. An older
  // dependency must not exhaust this test runner's stack or hang its process.
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { expand } from 'brace-expansion';
    assert.deepEqual(expand('file-{a,b}.{js,ts}'), ['file-a.js','file-a.ts','file-b.js','file-b.ts']);
    for (const input of [
      '{'.repeat(3200) + 'a,b' + '}'.repeat(3200),
      '{a,'.repeat(4000) + 'z' + '}'.repeat(4000),
      '{a},b}'.repeat(10000),
    ]) assert.ok(Array.isArray(expand(input, { max: 10, maxLength: 100000 })));
  `], { encoding: "utf8", timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

function packageNameFromLockPath(path) {
  const marker = "node_modules/";
  const start = path.lastIndexOf(marker);
  assert.notEqual(start, -1, `Unexpected lockfile package path: ${path}`);
  const segments = path.slice(start + marker.length).split("/");
  return segments[0].startsWith("@")
    ? `${segments[0]}/${segments[1]}`
    : segments[0];
}

test("production installs use a pinned npm and immutable lockfile", () => {
  assert.equal(packageJson.packageManager, `npm@${PINNED_NPM}`);
  assert.equal(vercel.installCommand, `npx --yes npm@${PINNED_NPM} ci`);
  assert.match(npmrc, /^strict-allow-scripts=true\s*$/m);
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.requires, true);
});

test("every dependency lifecycle script has an explicit allow or deny decision", () => {
  const scriptPackages = Object.entries(packageLock.packages)
    .filter(([path, metadata]) => path && metadata.hasInstallScript === true)
    .map(([path, metadata]) => ({
      name: packageNameFromLockPath(path),
      version: metadata.version,
    }));

  assert.deepEqual(scriptPackages, [
    { name: "ffmpeg-static", version: "5.3.0" },
    { name: "unrs-resolver", version: "1.12.2" },
  ]);

  for (const dependency of scriptPackages) {
    const exactIdentity = `${dependency.name}@${dependency.version}`;
    assert.ok(
      Object.hasOwn(packageJson.allowScripts, exactIdentity)
        || Object.hasOwn(packageJson.allowScripts, dependency.name),
      `Missing allowScripts decision for ${exactIdentity}`,
    );
  }

  assert.equal(packageJson.allowScripts["ffmpeg-static@5.3.0"], false);
  assert.equal(packageJson.allowScripts["unrs-resolver"], false);
});

test("locked registry artifacts have integrity and direct ranges reject exotic sources", () => {
  for (const [path, metadata] of Object.entries(packageLock.packages)) {
    if (!path || !metadata.resolved) continue;
    assert.match(
      metadata.resolved,
      /^https:\/\/registry\.npmjs\.org\//,
      `Non-registry dependency source at ${path}`,
    );
    assert.match(metadata.integrity || "", /^sha512-/, `Missing SHA-512 integrity at ${path}`);
  }

  const directDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const [name, range] of Object.entries(directDependencies)) {
    assert.notEqual(range, "*", `${name} cannot use a wildcard version`);
    assert.doesNotMatch(
      range,
      /^(?:git(?:\+[^:]+)?:|https?:|file:|link:|github:)/i,
      `${name} cannot use an exotic dependency source`,
    );
  }
});
