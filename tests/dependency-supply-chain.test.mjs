import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    .filter(([, metadata]) => metadata.hasInstallScript === true)
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

  assert.equal(packageJson.allowScripts["ffmpeg-static@5.3.0"], true);
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
